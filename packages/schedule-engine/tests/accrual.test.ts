import { describe, expect, it } from 'vitest';
import type { AccrualFacts, AccrualPolicy, Period } from '../src/accrual';
import { accrualPeriods, balanceOf, canUse, earnForPeriod, yearEndCarryover, yearsOfService } from '../src/accrual';

const policy = (over: Partial<AccrualPolicy> = {}): AccrualPolicy => ({
  period: { kind: 'monthly' },
  tiers: [
    { fromYears: 0, earn: { method: 'per_period', hours: 8 } },
    { fromYears: 5, earn: { method: 'per_period', hours: 12 } },
  ],
  cap: null,
  waitingPeriodDays: 0,
  prorateFirstPeriod: false,
  fractionByEmploymentType: {},
  negativeAllowed: false,
  carryover: { max: null, resetOn: null },
  ...over,
});
const facts = (over: Partial<AccrualFacts> = {}): AccrualFacts => ({
  hireDate: '2024-01-01',
  employmentType: 'career_full_time',
  hoursWorked: 0,
  balance: 0,
  separatedOn: null,
  ...over,
});
const DEC: Period = { start: '2026-12-01', endExclusive: '2027-01-01' };
const NOV: Period = { start: '2026-11-01', endExclusive: '2026-12-01' };

describe('yearsOfService', () => {
  it('counts whole years and flips on the anniversary', () => {
    expect(yearsOfService('2021-12-15', '2026-12-14')).toBe(4);
    expect(yearsOfService('2021-12-15', '2026-12-15')).toBe(5);
  });
});

describe('earnForPeriod', () => {
  it('per_period gives the tier hours', () => {
    expect(earnForPeriod(policy(), facts(), DEC).hours).toBe(8);
  });

  it('switches tier exactly at the anniversary (tier chosen on the last day of the period)', () => {
    const f = facts({ hireDate: '2021-12-15' });
    expect(earnForPeriod(policy(), f, NOV).hours).toBe(8);
    const dec = earnForPeriod(policy(), f, DEC);
    expect(dec.hours).toBe(12);
    expect(dec.explain.some((e) => e.rule === 'accrual.tier')).toBe(true);
  });

  it('per_hours_worked earns in proportion to hours worked', () => {
    const p = policy({ tiers: [{ fromYears: 0, earn: { method: 'per_hours_worked', perHours: 20, earnHours: 1 } }] });
    expect(earnForPeriod(p, facts({ hoursWorked: 120 }), DEC).hours).toBe(6);
  });

  it('applies a part-time fraction by employment type', () => {
    const p = policy({ fractionByEmploymentType: { career_part_time: 0.5 } });
    const r = earnForPeriod(p, facts({ employmentType: 'career_part_time' }), DEC);
    expect(r.hours).toBe(4);
    expect(r.explain.some((e) => e.rule === 'accrual.fraction')).toBe(true);
    expect(earnForPeriod(p, facts(), DEC).hours).toBe(8);
  });

  it('waiting period blocks accrual until the period ends after hire + N days', () => {
    const p = policy({ waitingPeriodDays: 90 });
    const f = facts({ hireDate: '2026-10-15' });
    const dec = earnForPeriod(p, f, DEC);
    expect(dec.hours).toBe(0);
    expect(dec.explain[0]?.rule).toBe('accrual.waiting');
    expect(earnForPeriod(p, f, { start: '2027-01-01', endExclusive: '2027-02-01' }).hours).toBe(8);
  });

  it('prorates the first period by days employed', () => {
    const p = policy({ prorateFirstPeriod: true });
    const r = earnForPeriod(p, facts({ hireDate: '2026-12-16' }), DEC);
    expect(r.hours).toBe(4.13); // 8 * 16 / 31
    expect(r.explain.some((e) => e.rule === 'accrual.prorate')).toBe(true);
  });

  it('does not prorate when the policy says not to', () => {
    expect(earnForPeriod(policy(), facts({ hireDate: '2026-12-16' }), DEC).hours).toBe(8);
  });

  it('stops earning at the cap and explains it', () => {
    const p = policy({ cap: 240 });
    const near = earnForPeriod(p, facts({ balance: 236 }), DEC);
    expect(near.hours).toBe(4);
    expect(near.explain.some((e) => e.rule === 'accrual.cap')).toBe(true);
    expect(earnForPeriod(p, facts({ balance: 240 }), DEC).hours).toBe(0);
    expect(earnForPeriod(p, facts({ balance: 300 }), DEC).hours).toBe(0);
  });

  it('earns nothing after separation', () => {
    const r = earnForPeriod(policy(), facts({ separatedOn: '2026-11-30' }), DEC);
    expect(r.hours).toBe(0);
    expect(r.explain[0]?.rule).toBe('accrual.separated');
  });

  it('annual_front_load credits only the period that contains Jan 1', () => {
    const p = policy({ tiers: [{ fromYears: 0, earn: { method: 'annual_front_load', hours: 120 } }] });
    expect(earnForPeriod(p, facts(), { start: '2026-01-01', endExclusive: '2026-02-01' }).hours).toBe(120);
    expect(earnForPeriod(p, facts(), { start: '2026-02-01', endExclusive: '2026-03-01' }).hours).toBe(0);
    expect(earnForPeriod(p, facts(), DEC).hours).toBe(0);
  });

  it('manual banks never accrue automatically', () => {
    const p = policy({ tiers: [{ fromYears: 0, earn: { method: 'manual' } }] });
    expect(earnForPeriod(p, facts(), DEC).hours).toBe(0);
  });

  it('a missing hire date uses the first tier without proration or waiting', () => {
    const p = policy({ prorateFirstPeriod: true, waitingPeriodDays: 90 });
    expect(earnForPeriod(p, facts({ hireDate: null }), DEC).hours).toBe(8);
  });
});

describe('yearEndCarryover', () => {
  const p = policy({ carryover: { max: 40, resetOn: '01-01' } });
  it('carries up to the max and expires the rest', () => {
    expect(yearEndCarryover(p, 55)).toMatchObject({ carried: 40, expired: 15 });
    expect(yearEndCarryover(p, 30)).toMatchObject({ carried: 30, expired: 0 });
  });
  it('carries everything when there is no max, and never expires a negative balance', () => {
    expect(yearEndCarryover(policy(), 55)).toMatchObject({ carried: 55, expired: 0 });
    expect(yearEndCarryover(p, -6)).toMatchObject({ carried: -6, expired: 0 });
  });
});

describe('canUse', () => {
  it('counts pending requests against the balance', () => {
    const r = canUse(policy(), 10, 6, 5);
    expect(r.ok).toBe(false);
    expect(r.explain[0]?.message).toContain('4 h available');
    expect(canUse(policy(), 10, 6, 4).ok).toBe(true);
  });
  it('lets negative-allowed policies go below zero', () => {
    expect(canUse(policy({ negativeAllowed: true }), 0, 0, 24).ok).toBe(true);
  });
});

describe('accrualPeriods', () => {
  it('monthly: every calendar month that overlaps the range', () => {
    expect(accrualPeriods({ kind: 'monthly' }, '2026-11-15', '2027-01-10')).toEqual([
      { start: '2026-11-01', endExclusive: '2026-12-01' },
      { start: '2026-12-01', endExclusive: '2027-01-01' },
      { start: '2027-01-01', endExclusive: '2027-02-01' },
    ]);
  });
  it('fixed_days: back-to-back blocks aligned to the anchor', () => {
    expect(accrualPeriods({ kind: 'fixed_days', days: 14, anchor: '2026-01-02' }, '2026-01-10', '2026-02-13')).toEqual([
      { start: '2026-01-02', endExclusive: '2026-01-16' },
      { start: '2026-01-16', endExclusive: '2026-01-30' },
      { start: '2026-01-30', endExclusive: '2026-02-13' },
    ]);
  });
});

describe('balanceOf', () => {
  it('sums signed hours', () => {
    expect(balanceOf([{ hours: 8 }, { hours: -24 }, { hours: 16.5 }])).toBe(0.5);
    expect(balanceOf([])).toBe(0);
  });
});
