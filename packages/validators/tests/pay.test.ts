import { describe, expect, it } from 'vitest';
import { isPermission } from '@soma/auth';
import { employeeGroupSchema, parsePayRulesJson, payCodeSchema, payRateSchema, payRulesSchema } from '../src/index';

const valid = () => ({
  payPeriod: { kind: 'fixed_days', days: 14, anchor: '2026-01-01' },
  workPeriod: { days: 28, anchor: '2026-01-01', threshold: 212, multiplier: 1.5, code: 'OT' },
  overtimeCombination: 'highest',
  assignments: {
    regular: { code: 'REG', multiplier: 1 },
    overtime: { code: 'OT', multiplier: 1.5 },
    trade: { code: 'REG', multiplier: 1 },
    holdover: { code: 'HOLD', multiplier: 1.5 },
    callback: { code: 'CALL', multiplier: 1.5, minimumHours: 2 },
    acting: { code: 'ACT', multiplier: 1 },
    training: { code: 'REG', multiplier: 1 },
    detail: { code: 'REG', multiplier: 1, countsTowardFlsa: false },
  },
  compTime: { mode: 'member_choice', multiplier: 1.5, bankKey: 'comp_time' },
});

describe('payRulesSchema', () => {
  it('accepts valid rules', () => {
    expect(payRulesSchema.safeParse(valid()).success).toBe(true);
  });

  it('requires a code for every assignment type', () => {
    const bad = valid() as { assignments: Record<string, unknown> };
    delete bad.assignments.holdover;
    const r = payRulesSchema.safeParse(bad);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['assignments', 'holdover']);
  });

  it('rejects impossible numbers', () => {
    const wp = (over: object) => ({ ...valid(), workPeriod: { ...valid().workPeriod, ...over } });
    expect(payRulesSchema.safeParse(wp({ days: 0 })).success).toBe(false);
    expect(payRulesSchema.safeParse(wp({ threshold: 0 })).success).toBe(false);
    expect(payRulesSchema.safeParse(wp({ multiplier: 0.5 })).success).toBe(false);
    expect(payRulesSchema.safeParse(wp({ multiplier: 9 })).success).toBe(false);
    expect(payRulesSchema.safeParse(wp({ code: '' })).success).toBe(false);
    expect(payRulesSchema.safeParse({ ...valid(), overtimeCombination: 'sum' }).success).toBe(false);
  });

  it('needs a comp bank whenever comp time is on', () => {
    const r = payRulesSchema.safeParse({ ...valid(), compTime: { mode: 'always', multiplier: 1.5, bankKey: null } });
    expect(r.error?.issues[0]).toMatchObject({ path: ['compTime', 'bankKey'] });
    expect(payRulesSchema.safeParse({ ...valid(), compTime: { mode: 'never', multiplier: 1.5, bankKey: null } }).success).toBe(true);
  });
});

describe('parsePayRulesJson', () => {
  it('explains malformed JSON and points at the failing path', () => {
    const bad = parsePayRulesJson('{ "workPeriod": ');
    expect(!bad.ok && bad.error).toContain('not valid JSON');
    const rules = valid();
    rules.workPeriod.threshold = -4;
    const r = parsePayRulesJson(JSON.stringify(rules));
    expect(!r.ok && r.error).toContain('workPeriod.threshold');
    expect(parsePayRulesJson(JSON.stringify(valid())).ok).toBe(true);
  });
});

describe('pay code, group and rate schemas', () => {
  it('derives keys and normalises blanks', () => {
    const c = payCodeSchema.parse({ label: 'Overtime 1.5', kind: 'overtime', multiplier: '1.5', countsTowardFlsa: 'on', exportCode: '' });
    expect(c).toMatchObject({ key: 'overtime_1_5', multiplier: 1.5, countsTowardFlsa: true, exportCode: null });
    expect(employeeGroupSchema.parse({ label: 'Line Firefighters' }).key).toBe('line_firefighters');
  });
  it('rejects a negative multiplier and unknown kinds', () => {
    expect(payCodeSchema.safeParse({ label: 'X', kind: 'overtime', multiplier: '-1' }).success).toBe(false);
    expect(payCodeSchema.safeParse({ label: 'X', kind: 'bonus', multiplier: '1' }).success).toBe(false);
  });
  it('validates a pay rate', () => {
    const base = { memberId: crypto.randomUUID(), effectiveFrom: '2026-07-01' };
    expect(payRateSchema.parse({ ...base, hourlyRate: '31.4567', note: '' })).toMatchObject({ hourlyRate: 31.4567, note: null });
    expect(payRateSchema.safeParse({ ...base, hourlyRate: '0' }).success).toBe(false);
    expect(payRateSchema.safeParse({ ...base, hourlyRate: '1001' }).success).toBe(false);
    expect(payRateSchema.safeParse({ ...base, hourlyRate: '12.34567' }).success).toBe(false);
  });
});

describe('permissions', () => {
  it('registers pay.view and pay.manage', () => {
    expect(isPermission('pay.view')).toBe(true);
    expect(isPermission('pay.manage')).toBe(true);
  });
});
