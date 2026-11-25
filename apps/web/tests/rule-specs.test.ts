import { describe, expect, it } from 'vitest';
import { accrualPolicySchema, payRulesSchema, unknownPaths } from '@soma/validators';
import { TEMPLATES } from '@soma/templates';
import { getAt, leafPaths, removeAt, setAt } from '@/components/rule-builder/path';
import { coveredPaths, SECTIONS } from '@/components/rule-builder/specs';

/** A document that sets every optional setting, so nothing can hide from the drift check. */
const FULL_PAY = (() => {
  let doc: Record<string, unknown> = JSON.parse(JSON.stringify(TEMPLATES['career-3-platoon'].pay.rules[0]!.payload));
  for (const t of ['regular', 'overtime', 'trade', 'holdover', 'callback', 'acting', 'training', 'detail']) {
    doc = setAt(doc, `assignments.${t}.countsTowardFlsa`, true);
    doc = setAt(doc, `assignments.${t}.minimumHours`, 1);
  }
  return doc;
})();

const FULL_ACCRUAL: Record<string, unknown> = {
  period: { kind: 'fixed_days', days: 14, anchor: '2026-01-01' },
  tiers: [
    { fromYears: 0, earn: { method: 'per_period', hours: 8 } },
    { fromYears: 5, earn: { method: 'per_hours_worked', perHours: 40, earnHours: 1 } },
  ],
  cap: 240,
  waitingPeriodDays: 30,
  prorateFirstPeriod: true,
  fractionByEmploymentType: { career_part_time: 0.5 },
  negativeAllowed: false,
  carryover: { max: 240, resetOn: '01-01' },
};

const CASES = [
  ['pay', FULL_PAY, payRulesSchema],
  ['accrual', FULL_ACCRUAL, accrualPolicySchema],
] as const;

describe.each(CASES)('%s rule specs', (kind, full, schema) => {
  it('the full sample document is valid and uses only settings the schema knows', () => {
    const parsed = schema.parse(full);
    expect(unknownPaths(full, parsed)).toEqual([]);
  });

  it('every setting in the schema has a spec (or belongs to a custom editor)', () => {
    const { exact, prefixes } = coveredPaths(kind);
    const missing = leafPaths(full).filter((p) => !exact.has(p) && !prefixes.some((x) => p === x || p.startsWith(`${x}.`)));
    expect(missing).toEqual([]);
  });

  it('every spec points at a real setting', () => {
    const doc = full as Record<string, unknown>;
    const stale = SECTIONS[kind].flatMap((s) => s.fields).filter((f) => getAt(doc, f.path) === undefined).map((f) => f.path);
    expect(stale).toEqual([]);
  });

  it('every field has a label and help text', () => {
    for (const s of SECTIONS[kind]) for (const f of s.fields) {
      expect(f.label.length, f.path).toBeGreaterThan(2);
      expect(f.help.length, f.path).toBeGreaterThan(8);
    }
  });
});

describe('path helpers', () => {
  it('set, remove and read without mutating the original', () => {
    const doc = { a: { b: [1, { c: 2 }] } };
    const next = setAt(doc, 'a.b.1.c', 3);
    expect(getAt(next, 'a.b.1.c')).toBe(3);
    expect(doc.a.b[1]).toEqual({ c: 2 });
    expect(getAt(removeAt(next, 'a.b.1.c'), 'a.b.1')).toEqual({});
    expect(getAt(setAt({}, 'x.y', 1), 'x.y')).toBe(1);
  });
});
