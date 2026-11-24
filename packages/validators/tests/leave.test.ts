import { describe, expect, it } from 'vitest';
import { isPermission } from '@soma/auth';
import { accrualPolicySchema, adjustmentSchema, bankSchema, leaveRequestSchema, leaveTypeSchema, parseAccrualPolicyJson } from '../src/index';

const valid = () => ({
  period: { kind: 'monthly' },
  tiers: [
    { fromYears: 0, earn: { method: 'per_period', hours: 8 } },
    { fromYears: 5, earn: { method: 'per_hours_worked', perHours: 20, earnHours: 1 } },
  ],
  cap: 240,
  waitingPeriodDays: 0,
  prorateFirstPeriod: true,
  fractionByEmploymentType: { career_part_time: 0.5 },
  negativeAllowed: false,
  carryover: { max: 40, resetOn: '01-01' },
});

describe('accrualPolicySchema', () => {
  it('accepts a valid policy', () => {
    expect(accrualPolicySchema.safeParse(valid()).success).toBe(true);
  });

  it('rejects empty, mis-ordered or non-zero-start tiers', () => {
    expect(accrualPolicySchema.safeParse({ ...valid(), tiers: [] }).success).toBe(false);
    expect(accrualPolicySchema.safeParse({ ...valid(), tiers: [{ fromYears: 1, earn: { method: 'manual' } }] }).success).toBe(false);
    const dup = [{ fromYears: 0, earn: { method: 'manual' } }, { fromYears: 0, earn: { method: 'manual' } }];
    expect(accrualPolicySchema.safeParse({ ...valid(), tiers: dup }).success).toBe(false);
    const unsorted = [{ fromYears: 0, earn: { method: 'manual' } }, { fromYears: 5, earn: { method: 'manual' } }, { fromYears: 3, earn: { method: 'manual' } }];
    expect(accrualPolicySchema.safeParse({ ...valid(), tiers: unsorted }).success).toBe(false);
  });

  it('rejects negative numbers, zero divisors, bad dates and fractions', () => {
    const t = (earn: unknown) => ({ ...valid(), tiers: [{ fromYears: 0, earn }] });
    expect(accrualPolicySchema.safeParse(t({ method: 'per_period', hours: -1 })).success).toBe(false);
    expect(accrualPolicySchema.safeParse(t({ method: 'per_hours_worked', perHours: 0, earnHours: 1 })).success).toBe(false);
    expect(accrualPolicySchema.safeParse({ ...valid(), carryover: { max: 40, resetOn: '13-40' } }).success).toBe(false);
    expect(accrualPolicySchema.safeParse({ ...valid(), fractionByEmploymentType: { career_part_time: 1.5 } }).success).toBe(false);
    expect(accrualPolicySchema.safeParse({ ...valid(), fractionByEmploymentType: { career_part_time: 0 } }).success).toBe(false);
    expect(accrualPolicySchema.safeParse({ ...valid(), cap: -5 }).success).toBe(false);
    expect(accrualPolicySchema.safeParse({ ...valid(), period: { kind: 'fixed_days', days: 14, anchor: 'soon' } }).success).toBe(false);
  });
});

describe('parseAccrualPolicyJson', () => {
  it('returns the policy for valid JSON', () => {
    const r = parseAccrualPolicyJson(JSON.stringify(valid()));
    expect(r.ok).toBe(true);
  });
  it('explains malformed JSON', () => {
    const r = parseAccrualPolicyJson('{ "period": ');
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toContain('not valid JSON');
  });
  it('points at the failing path', () => {
    const bad = valid();
    bad.tiers[1] = { fromYears: 5, earn: { method: 'per_period', hours: -2 } as never };
    const r = parseAccrualPolicyJson(JSON.stringify(bad));
    expect(!r.ok && r.error).toContain('tiers.1.earn.hours');
  });
});

describe('bank and leave type schemas', () => {
  it('derive a key from the label', () => {
    expect(bankSchema.parse({ label: 'Sick Leave' }).key).toBe('sick_leave');
    const t = leaveTypeSchema.parse({ label: 'Vacation', bankId: '', leadTimeDays: '7', requiresDocumentation: 'on' });
    expect(t).toMatchObject({ key: 'vacation', bankId: null, leadTimeDays: 7, requiresDocumentation: true, countsAsWorked: false });
  });
  it('rejects negative lead time', () => {
    expect(leaveTypeSchema.safeParse({ label: 'X', leadTimeDays: '-1' }).success).toBe(false);
  });
});

describe('leaveRequestSchema', () => {
  const base = { leaveTypeId: crypto.randomUUID(), startDate: '2026-12-10', endDate: '2026-12-12' };
  it('requires end on or after start and trims the reason', () => {
    expect(leaveRequestSchema.parse({ ...base, reason: '' }).reason).toBeNull();
    expect(leaveRequestSchema.safeParse({ ...base, endDate: '2026-12-09' }).success).toBe(false);
    expect(leaveRequestSchema.safeParse({ ...base, endDate: '2026-12-10' }).success).toBe(true);
  });
});

describe('adjustmentSchema', () => {
  const base = { memberId: crypto.randomUUID(), bankId: crypto.randomUUID(), note: 'Opening balance' };
  it('needs a non-zero hours value within bounds and a real note', () => {
    expect(adjustmentSchema.parse({ ...base, hours: '8' }).hours).toBe(8);
    expect(adjustmentSchema.safeParse({ ...base, hours: '0' }).success).toBe(false);
    expect(adjustmentSchema.safeParse({ ...base, hours: '5000' }).success).toBe(false);
    expect(adjustmentSchema.safeParse({ ...base, hours: '8', note: 'ok' }).success).toBe(false);
  });
});

describe('permissions', () => {
  it('registers the leave permissions', () => {
    for (const p of ['leave.request', 'leave.approve', 'leave.view', 'leave.manage']) expect(isPermission(p)).toBe(true);
  });
});
