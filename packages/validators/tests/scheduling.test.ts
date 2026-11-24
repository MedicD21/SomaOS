import { describe, expect, it } from 'vitest';
import {
  ASSIGNMENT_TYPES,
  assignSchema,
  credentialTypeSchema,
  memberCredentialSchema,
  seatSchema,
  shiftPatternSchema,
  standingSeatSchema,
  validitySchema,
} from '../src/scheduling';

const p24 = {
  cycle: ['on', 'off', 'off'],
  shiftStart: '07:00',
  shiftHours: 24,
  anchorDate: '2026-01-01',
  platoons: { a: 0, b: 1, c: 2 },
  kelly: { everyNthShift: 9 },
};
const id = '11111111-1111-4111-8111-111111111111';

describe('shiftPatternSchema', () => {
  it('accepts p24', () => expect(shiftPatternSchema.safeParse(p24).success).toBe(true));
  it('rejects bad cycle/start/hours', () => {
    expect(shiftPatternSchema.safeParse({ ...p24, cycle: ['off'] }).success).toBe(false);
    expect(shiftPatternSchema.safeParse({ ...p24, cycle: [] }).success).toBe(false);
    expect(shiftPatternSchema.safeParse({ ...p24, shiftStart: '24:00' }).success).toBe(false);
    expect(shiftPatternSchema.safeParse({ ...p24, shiftHours: 0 }).success).toBe(false);
    expect(shiftPatternSchema.safeParse({ ...p24, shiftHours: 49 }).success).toBe(false);
    expect(shiftPatternSchema.safeParse({ ...p24, kelly: { everyNthShift: 1 } }).success).toBe(false);
    expect(shiftPatternSchema.safeParse({ ...p24, platoons: { a: 56 } }).success).toBe(false);
    expect(shiftPatternSchema.safeParse({ ...p24, anchorDate: '2026-02-30' }).success).toBe(false);
  });
  it('kelly optional', () => {
    expect(shiftPatternSchema.safeParse({ ...p24, kelly: undefined }).success).toBe(true);
  });
});

describe('validitySchema', () => {
  it('accepts valid', () => {
    expect(validitySchema.safeParse({ kind: 'none' }).success).toBe(true);
    expect(validitySchema.safeParse({ kind: 'months', months: 24 }).success).toBe(true);
    expect(validitySchema.safeParse({ kind: 'fixed_cycle', month: 12, day: 31, years: 2 }).success).toBe(true);
  });
  it('rejects invalid', () => {
    expect(validitySchema.safeParse({ kind: 'months', months: 0 }).success).toBe(false);
    expect(validitySchema.safeParse({ kind: 'months', months: 241 }).success).toBe(false);
    expect(validitySchema.safeParse({ kind: 'fixed_cycle', month: 2, day: 30, years: 1 }).success).toBe(false);
    expect(validitySchema.safeParse({ kind: 'fixed_cycle', month: 13, day: 1, years: 1 }).success).toBe(false);
    expect(validitySchema.safeParse({ kind: 'fixed_cycle', month: 1, day: 1, years: 11 }).success).toBe(false);
  });
});

describe('credentialTypeSchema', () => {
  it('defaults warnDays', () => {
    const r = credentialTypeSchema.parse({ key: 'cpr', label: 'CPR', validity: { kind: 'none' } });
    expect(r.warnDays).toEqual([90, 60, 30, 7]);
  });
  it('rejects warnDays out of range', () => {
    expect(
      credentialTypeSchema.safeParse({ key: 'cpr', label: 'CPR', validity: { kind: 'none' }, warnDays: [400] }).success,
    ).toBe(false);
  });
});

describe('seatSchema', () => {
  it('coerces form values', () => {
    const r = seatSchema.parse({ orgUnitId: id, label: 'Officer', sort: '1', required: true, actingAllowed: false, requirementGroups: [[id]] });
    expect(r.sort).toBe(1);
    expect(r.minRankId).toBeUndefined();
  });
});

describe('assignSchema', () => {
  const base = { seatId: id, memberId: id, start: '2026-01-01T07:00:00-05:00', end: '2026-01-02T07:00:00-05:00', type: 'regular' };
  it('accepts valid', () => expect(assignSchema.safeParse(base).success).toBe(true));
  it('rejects short overrideReason', () => expect(assignSchema.safeParse({ ...base, overrideReason: 'ok' }).success).toBe(false));
  it('rejects bad type / naive datetime', () => {
    expect(assignSchema.safeParse({ ...base, type: 'bogus' }).success).toBe(false);
    expect(assignSchema.safeParse({ ...base, start: '2026-01-01T07:00:00' }).success).toBe(false);
  });
  it('has 9 types', () => expect(ASSIGNMENT_TYPES).toHaveLength(9));
});

describe('memberCredentialSchema / standingSeatSchema', () => {
  it('validate', () => {
    expect(memberCredentialSchema.safeParse({ memberId: id, typeId: id, issuedOn: '2026-01-01' }).success).toBe(true);
    expect(memberCredentialSchema.safeParse({ memberId: id, typeId: id, issuedOn: '2026-13-01' }).success).toBe(false);
    expect(standingSeatSchema.safeParse({ memberId: id, seatId: id, platoonShiftId: id, kellyGroup: '3', effectiveFrom: '2026-01-01' }).success).toBe(true);
    expect(standingSeatSchema.safeParse({ memberId: id, seatId: id, platoonShiftId: id, kellyGroup: 30, effectiveFrom: '2026-01-01' }).success).toBe(false);
  });
});
