import { describe, expect, it } from 'vitest';
import {
  checkQualification,
  credentialExpiry,
  dueWarning,
  type MemberQual,
  type SeatRule,
} from '../src/credentials';

const TZ = 'America/Chicago';
const cycle = { kind: 'fixed_cycle', month: 3, day: 31, years: 2 } as const;

describe('credentialExpiry', () => {
  it('fixed cycle', () => {
    expect(credentialExpiry(cycle, '2026-02-10')).toBe('2028-03-31');
    expect(credentialExpiry(cycle, '2026-05-01')).toBe('2029-03-31');
    expect(credentialExpiry(cycle, '2026-03-31')).toBe('2028-03-31');
  });
  it('months and none', () => {
    expect(credentialExpiry({ kind: 'months', months: 24 }, '2026-01-15')).toBe('2028-01-15');
    expect(credentialExpiry({ kind: 'none' }, '2026-01-15')).toBeNull();
  });
});

const seat = (over: Partial<SeatRule> = {}): SeatRule => ({
  requirements: [{ anyOf: ['pm'] }],
  minRankSort: null,
  actingAllowed: false,
  ...over,
});
const member = (expiresOn: string | null, rankSort: number | null = null): MemberQual => ({
  rankSort,
  credentials: [{ typeId: 'pm', typeLabel: 'Paramedic', expiresOn }],
});
const shiftEnd = new Date('2026-04-01T12:00:00Z');

describe('checkQualification', () => {
  it('fails when expired before shift end', () => {
    const r = checkQualification(seat(), member('2026-03-31'), shiftEnd, TZ);
    expect(r.qualified).toBe(false);
    expect(r.explain.map((e) => e.rule)).toContain('credential.expired_before_shift_end');
    expect(r.explain[0]?.message).toContain('Paramedic expires 2026-03-31');
  });
  it('expiry date is inclusive', () => {
    expect(checkQualification(seat(), member('2026-04-01'), shiftEnd, TZ).qualified).toBe(true);
    expect(checkQualification(seat(), member(null), shiftEnd, TZ).qualified).toBe(true);
  });
  it('any-of satisfied by either', () => {
    const s = seat({ requirements: [{ anyOf: ['emt', 'pm'] }] });
    expect(checkQualification(s, member(null), shiftEnd, TZ).qualified).toBe(true);
    const emt: MemberQual = {
      rankSort: null,
      credentials: [{ typeId: 'emt', typeLabel: 'EMT', expiresOn: null }],
    };
    expect(checkQualification(s, emt, shiftEnd, TZ).qualified).toBe(true);
  });
  it('missing group names type ids', () => {
    const s = seat({ requirements: [{ anyOf: ['emt', 'pm'] }] });
    const r = checkQualification(s, { rankSort: null, credentials: [] }, shiftEnd, TZ);
    expect(r.qualified).toBe(false);
    expect(r.explain[0]?.rule).toBe('credential.missing');
    expect(r.explain[0]?.data).toEqual({ anyOf: ['emt', 'pm'] });
    expect(r.explain[0]?.message).toContain('emt');
    expect(r.explain[0]?.message).toContain('pm');
  });
  it('rank below minimum, acting allowed', () => {
    const no = checkQualification(
      seat({ minRankSort: 5 }),
      member(null, 7),
      shiftEnd,
      TZ,
    );
    expect(no.qualified).toBe(false);
    expect(no.explain.map((e) => e.rule)).toContain('rank.below_minimum');
    const yes = checkQualification(
      seat({ minRankSort: 5, actingAllowed: true }),
      member(null, 7),
      shiftEnd,
      TZ,
    );
    expect(yes.qualified).toBe(true);
    expect(yes.acting).toBe(true);
    expect(yes.explain.map((e) => e.rule)).toContain('rank.acting');
  });
  it('null rank with min rank fails', () => {
    const r = checkQualification(seat({ minRankSort: 5 }), member(null, null), shiftEnd, TZ);
    expect(r.qualified).toBe(false);
  });
  it('acting not set when rank is fine', () => {
    const r = checkQualification(seat({ minRankSort: 5 }), member(null, 5), shiftEnd, TZ);
    expect(r).toMatchObject({ qualified: true, acting: false });
  });
});

describe('dueWarning', () => {
  const w = [90, 60, 30, 7];
  it('thresholds', () => {
    expect(dueWarning('2026-03-31', '2026-01-01', w, null)).toBe(90);
    expect(dueWarning('2026-03-31', '2026-01-01', w, 90)).toBeNull();
    expect(dueWarning('2026-03-31', '2026-03-01', w, 90)).toBe(30);
    expect(dueWarning('2026-03-31', '2025-06-01', w, null)).toBeNull();
  });
  it('expired', () => {
    expect(dueWarning('2026-03-31', '2026-04-02', w, 7)).toBe(0);
    expect(dueWarning('2026-03-31', '2026-04-02', w, 0)).toBeNull();
  });
});
