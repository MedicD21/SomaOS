import { describe, expect, it } from 'vitest';
import { accrualPolicySchema, issuesToFieldErrors, parseJsonDocument, payRulesSchema, unknownPaths } from '../src';

const rules = {
  payPeriod: { kind: 'fixed_days', days: 14, anchor: '2026-01-01' },
  workPeriod: { days: 28, anchor: '2026-01-01', threshold: 212, multiplier: 1.5, code: 'ot' },
  overtimeCombination: 'highest',
  assignments: Object.fromEntries(
    ['regular', 'overtime', 'trade', 'holdover', 'callback', 'acting', 'training', 'detail'].map((t) => [t, { code: 'reg', multiplier: 1 }]),
  ),
  compTime: { mode: 'never', multiplier: 1.5, bankKey: 'comp_time' },
};

describe('issuesToFieldErrors', () => {
  it('maps a range error to its dotted path with plain English', () => {
    const r = payRulesSchema.safeParse({ ...rules, workPeriod: { ...rules.workPeriod, multiplier: 9 } });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(issuesToFieldErrors(r.error.issues)['workPeriod.multiplier']).toBe('Enter a number no larger than 5.');
  });

  it('maps the comp-time cross-field rule to the bank field', () => {
    const r = payRulesSchema.safeParse({ ...rules, compTime: { mode: 'always', multiplier: 1.5, bankKey: null } });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(issuesToFieldErrors(r.error.issues)['compTime.bankKey']).toBe('Choose the leave bank comp time is credited to');
  });

  it('maps tier ordering to the offending tier', () => {
    const r = accrualPolicySchema.safeParse({
      period: { kind: 'monthly' },
      tiers: [
        { fromYears: 0, earn: { method: 'per_period', hours: 8 } },
        { fromYears: 0, earn: { method: 'per_period', hours: 9 } },
      ],
      cap: null,
      waitingPeriodDays: 0,
      prorateFirstPeriod: true,
      fractionByEmploymentType: {},
      negativeAllowed: false,
      carryover: { max: null, resetOn: null },
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(issuesToFieldErrors(r.error.issues)['tiers.1.fromYears']).toBe('Tiers must be in strictly increasing order of years');
  });

  it('keeps only the first message per path and rewrites type errors', () => {
    const r = payRulesSchema.safeParse({ ...rules, workPeriod: { ...rules.workPeriod, threshold: 'lots' } });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(issuesToFieldErrors(r.error.issues)['workPeriod.threshold']).toBe('Enter a number.');
  });
});

describe('parseJsonDocument', () => {
  it('parses JSON and reports unparseable text in plain English', () => {
    expect(parseJsonDocument('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    const bad = parseJsonDocument('{ "a": ');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/^That is not valid JSON/);
  });
});

describe('unknownPaths', () => {
  it('lists keys in the hand-edited document that the schema does not know', () => {
    const raw = { ...rules, extra: 1, workPeriod: { ...rules.workPeriod, note: 'x' }, assignments: { ...rules.assignments, regular: { code: 'reg', multiplier: 1, bonus: 2 } } };
    const parsed = payRulesSchema.parse(raw);
    expect(unknownPaths(raw, parsed)).toEqual(['assignments.regular.bonus', 'extra', 'workPeriod.note']);
  });

  it('is empty when nothing extra was typed, and handles arrays', () => {
    expect(unknownPaths(rules, payRulesSchema.parse(rules))).toEqual([]);
    expect(unknownPaths({ tiers: [{ a: 1, b: 2 }] }, { tiers: [{ a: 1 }] })).toEqual(['tiers.0.b']);
  });
});
