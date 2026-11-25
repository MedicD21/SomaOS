import { describe, expect, it } from 'vitest';
import type { AccrualPolicy } from '../src/accrual';
import type { PayRules } from '../src/pay';
import type { ShiftPattern } from '../src/pattern';
import { comparePatterns, projectAccrual, samplePay } from '../src/simulate';

const RULES: PayRules = {
  payPeriod: { kind: 'fixed_days', days: 14, anchor: '2026-01-01' },
  workPeriod: { days: 28, anchor: '2026-01-01', threshold: 212, multiplier: 1.5, code: 'ot' },
  overtimeCombination: 'highest',
  assignments: {
    regular: { code: 'reg', multiplier: 1 },
    overtime: { code: 'ot', multiplier: 1.5 },
    trade: { code: 'reg', multiplier: 1 },
    holdover: { code: 'hold', multiplier: 1.5 },
    callback: { code: 'call', multiplier: 1.5, minimumHours: 2 },
    acting: { code: 'act', multiplier: 1 },
    training: { code: 'reg', multiplier: 1 },
    detail: { code: 'reg', multiplier: 1 },
  },
  compTime: { mode: 'never', multiplier: 1.5, bankKey: 'comp_time' },
};

describe('samplePay', () => {
  it('splits the shift that crosses the threshold (20 h regular + 4 h overtime)', () => {
    const r = samplePay(RULES, { hourlyRate: 30, start: '2026-01-01', shifts: [{ type: 'regular', hours: 24, count: 9 }] });
    expect(r.totalHours).toBe(216);
    const reg = r.lines.find((l) => l.code === 'reg')!;
    const ot = r.lines.find((l) => l.code === 'ot')!;
    expect(reg.hours).toBe(212);
    expect(ot.hours).toBe(4);
    expect(r.totalAmount).toBe(212 * 30 + 4 * 45);
  });

  it('applies the callback minimum and comp time from the rules given', () => {
    const rules: PayRules = { ...RULES, compTime: { mode: 'always', multiplier: 1.5, bankKey: 'comp_time' } };
    const r = samplePay(rules, { hourlyRate: null, start: '2026-01-01', shifts: [{ type: 'callback', hours: 1, count: 1 }] });
    expect(r.lines.map((l) => [l.code, l.hours, l.source])).toEqual([
      ['call', 1, 'callback_minimum'],
      ['call', 1, 'work'],
    ]);
    expect(r.totalAmount).toBeNull();
    // Only the hour actually worked is taken as comp time; the guaranteed top-up is not.
    expect(r.comp.hours).toBe(1.5);
  });
});

const POLICY: AccrualPolicy = {
  period: { kind: 'monthly' },
  tiers: [{ fromYears: 0, earn: { method: 'per_period', hours: 8 } }],
  cap: null,
  waitingPeriodDays: 0,
  prorateFirstPeriod: true,
  fractionByEmploymentType: {},
  negativeAllowed: false,
  carryover: { max: null, resetOn: null },
};
const FACTS = { hireDate: '2020-01-01', employmentType: 'career_full_time', hoursWorked: 0, balance: 0, separatedOn: null };

describe('projectAccrual', () => {
  it('projects running balances and stops at the cap', () => {
    const rows = projectAccrual({ ...POLICY, cap: 20 }, FACTS, '2026-01-15', 4);
    expect(rows.map((r) => [r.period.start, r.hours, r.balanceAfter, r.capped])).toEqual([
      ['2026-01-01', 8, 8, false],
      ['2026-02-01', 8, 16, false],
      ['2026-03-01', 4, 20, true],
      ['2026-04-01', 0, 20, true],
    ]);
  });

  it('forfeits the balance above the carryover limit when the reset date passes', () => {
    const rows = projectAccrual({ ...POLICY, carryover: { max: 10, resetOn: '01-01' } }, FACTS, '2025-11-10', 4);
    expect(rows.map((r) => [r.period.start, r.expired, r.hours, r.balanceAfter])).toEqual([
      ['2025-11-01', 0, 8, 8],
      ['2025-12-01', 0, 8, 16],
      ['2026-01-01', 6, 8, 18],
      ['2026-02-01', 0, 8, 26],
    ]);
  });

  it('uses the sample hours worked per period for per-hours-worked tiers', () => {
    const policy: AccrualPolicy = { ...POLICY, tiers: [{ fromYears: 0, earn: { method: 'per_hours_worked', perHours: 40, earnHours: 1 } }] };
    const rows = projectAccrual(policy, FACTS, '2026-01-01', 2, { hoursWorkedPerPeriod: 120 });
    expect(rows.map((r) => r.hours)).toEqual([3, 3]);
  });

  it('starts from the balance given', () => {
    expect(projectAccrual(POLICY, { ...FACTS, balance: 50 }, '2026-01-01', 1)[0]!.balanceAfter).toBe(58);
  });
});

const APPROVED: ShiftPattern = {
  cycle: ['on', 'off', 'off'],
  shiftStart: '07:00',
  shiftHours: 24,
  anchorDate: '2026-01-01',
  platoons: { a: 0, b: 1 },
};

describe('comparePatterns', () => {
  it('marks exactly the dates that change', () => {
    const draft: ShiftPattern = { ...APPROVED, cycle: ['on', 'off', 'off', 'off'] };
    const r = comparePatterns(APPROVED, draft, 'a', '2026-01-01', '2026-01-11', 'America/New_York');
    expect(r.approved).toEqual(['2026-01-01', '2026-01-04', '2026-01-07', '2026-01-10']);
    expect(r.draft).toEqual(['2026-01-01', '2026-01-05', '2026-01-09']);
    expect(r.added).toEqual(['2026-01-05', '2026-01-09']);
    expect(r.removed).toEqual(['2026-01-04', '2026-01-07', '2026-01-10']);
    expect(r.approvedHours).toBe(96);
    expect(r.draftHours).toBe(72);
    expect(r.warnings).toEqual([]);
  });

  it('reports a shift that has no offset instead of throwing', () => {
    const draft: ShiftPattern = { ...APPROVED, platoons: { a: 0 } };
    const r = comparePatterns(APPROVED, draft, 'b', '2026-01-01', '2026-01-11', 'America/New_York');
    expect(r.draft).toEqual([]);
    expect(r.approved.length).toBeGreaterThan(0);
    expect(r.warnings).toEqual(['The draft has no offset for shift "b".']);
  });

  it('treats a first pattern (nothing approved) as everything added', () => {
    const r = comparePatterns(null, APPROVED, 'a', '2026-01-01', '2026-01-08', 'America/New_York');
    expect(r.approved).toEqual([]);
    expect(r.added).toEqual(['2026-01-01', '2026-01-04', '2026-01-07']);
  });
});
