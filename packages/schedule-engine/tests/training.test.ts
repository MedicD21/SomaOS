import { describe, expect, it } from 'vitest';
import { trainingCompliance, windowFor, type TrainingHours, type TrainingMember, type TrainingRequirement } from '../src/training';

describe('windowFor', () => {
  it('calendar_year covers January 1 to December 31 and rolls over at the boundary', () => {
    expect(windowFor({ kind: 'calendar_year' }, '2026-06-15')).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(windowFor({ kind: 'calendar_year' }, '2026-12-31')).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(windowFor({ kind: 'calendar_year' }, '2027-01-01')).toEqual({ start: '2027-01-01', end: '2027-12-31' });
  });

  it('rolling_months ends today and starts the day after the same date N months ago', () => {
    expect(windowFor({ kind: 'rolling_months', months: 12 }, '2026-03-01')).toEqual({ start: '2025-03-02', end: '2026-03-01' });
    // Leap day: one year before 2024-02-29 is 2023-02-28, so the window starts on 2023-03-01 and includes the leap day.
    expect(windowFor({ kind: 'rolling_months', months: 12 }, '2024-02-29')).toEqual({ start: '2023-03-01', end: '2024-02-29' });
  });

  it('fixed_cycle: annual cycles end on month/day, starting at the anchor', () => {
    const w = { kind: 'fixed_cycle', month: 6, day: 30, years: 1 } as const;
    expect(windowFor(w, '2026-06-30', '2026-01-01')).toEqual({ start: '2026-01-01', end: '2026-06-30' });
    expect(windowFor(w, '2026-07-01', '2026-01-01')).toEqual({ start: '2026-07-01', end: '2027-06-30' });
    expect(windowFor(w, '2028-01-15', '2026-01-01')).toEqual({ start: '2027-07-01', end: '2028-06-30' });
  });

  it('fixed_cycle: multi-year cycles count from the first cutoff after the anchor', () => {
    const w = { kind: 'fixed_cycle', month: 3, day: 31, years: 2 } as const;
    expect(windowFor(w, '2026-02-01', '2026-01-01')).toEqual({ start: '2026-01-01', end: '2026-03-31' });
    expect(windowFor(w, '2027-01-01', '2026-01-01')).toEqual({ start: '2026-04-01', end: '2028-03-31' });
    expect(windowFor(w, '2028-04-01', '2026-01-01')).toEqual({ start: '2028-04-01', end: '2030-03-31' });
  });

  it('fixed_cycle: February 29 falls back to February 28 in a non-leap year', () => {
    const w = { kind: 'fixed_cycle', month: 2, day: 29, years: 1 } as const;
    expect(windowFor(w, '2027-01-15', '2027-01-01')).toEqual({ start: '2027-01-01', end: '2027-02-28' });
    expect(windowFor(w, '2027-03-01', '2027-01-01')).toEqual({ start: '2027-03-01', end: '2028-02-29' });
  });
});

const FIRE = 'cat-fire';
const EMS = 'cat-ems';
const req = (over: Partial<TrainingRequirement> = {}): TrainingRequirement => ({
  id: 'r1', label: 'Fire hours', categoryId: FIRE, rankId: null, roleId: null, requiredHours: 20,
  window: { kind: 'calendar_year' }, effectiveFrom: '2020-01-01', effectiveTo: null, ...over,
});
const member = (over: Partial<TrainingMember> = {}): TrainingMember => ({ id: 'm1', rankId: null, roleIds: [], ...over });
const hrs = (creditedOn: string, hours: number, over: Partial<TrainingHours> = {}): TrainingHours => ({
  memberId: 'm1', categoryId: FIRE, creditedOn, hours, ...over,
});
const run = (over: Parameters<typeof trainingCompliance>[0] extends infer T ? Partial<T> : never) =>
  trainingCompliance({ requirements: [req()], members: [member()], hours: [], today: '2026-06-15', ...over });

describe('trainingCompliance status', () => {
  it('met when earned reaches the requirement (exactly, with rounding)', () => {
    const [r] = run({ hours: [hrs('2026-02-01', 10.1), hrs('2026-03-01', 9.9)] });
    expect(r).toMatchObject({ status: 'met', earned: 20, remaining: 0 });
    const [c] = run({ requirements: [req({ requiredHours: 0.3 })], hours: [hrs('2026-02-01', 0.1), hrs('2026-03-01', 0.2)] });
    expect(c).toMatchObject({ status: 'met', earned: 0.3 });
  });

  it('on_track early in the window and due_soon near its end', () => {
    expect(run({ today: '2026-06-15' })[0]).toMatchObject({ status: 'on_track', remaining: 20 });
    expect(run({ today: '2026-12-31' })[0]).toMatchObject({ status: 'due_soon', windowEnd: '2026-12-31' });
  });

  it('due_soon starts exactly dueSoonDays before the window end', () => {
    expect(run({ today: '2026-12-01', dueSoonDays: 30 })[0]!.status).toBe('due_soon');
    expect(run({ today: '2026-11-30', dueSoonDays: 30 })[0]!.status).toBe('on_track');
  });

  it('hours outside the window or in another category do not count', () => {
    const [r] = run({ hours: [hrs('2025-12-31', 8), hrs('2027-01-01', 8), hrs('2026-05-01', 5, { categoryId: EMS }), hrs('2026-01-01', 4), hrs('2026-12-31', 3)] });
    expect(r).toMatchObject({ earned: 7, remaining: 13 });
  });

  it('another member\'s hours do not count', () => {
    const [r] = run({ hours: [hrs('2026-02-01', 20, { memberId: 'm2' })] });
    expect(r).toMatchObject({ earned: 0, status: 'on_track' });
  });

  it('rolling windows have no end, so a shortfall is overdue straight away', () => {
    const [r] = run({ requirements: [req({ window: { kind: 'rolling_months', months: 12 } })], hours: [hrs('2025-06-14', 20), hrs('2025-06-15', 5)] });
    // 2025-06-14 is outside the window that starts 2025-06-16; 2025-06-15 is too.
    expect(r).toMatchObject({ earned: 0, status: 'overdue', windowEnd: '2026-06-15' });
    const [ok] = run({ requirements: [req({ window: { kind: 'rolling_months', months: 12 } })], hours: [hrs('2025-06-16', 20)] });
    expect(ok!.status).toBe('met');
  });
});

describe('overdue after a window ends short', () => {
  const hours = [hrs('2026-03-01', 12)];

  it('reports the window that just ended as overdue for the grace period', () => {
    const [r] = run({ today: '2027-01-10', hours });
    expect(r).toMatchObject({ status: 'overdue', earned: 12, remaining: 8, windowStart: '2026-01-01', windowEnd: '2026-12-31' });
    expect(r!.explain[0]!.message).toContain('8 h short');
  });

  it('then moves on to the new window, and earlier hours do not carry forward', () => {
    const [r] = run({ today: '2027-02-15', hours });
    expect(r).toMatchObject({ status: 'on_track', earned: 0, windowStart: '2027-01-01', windowEnd: '2027-12-31' });
  });

  it('is not overdue when the previous window was met', () => {
    const [r] = run({ today: '2027-01-10', hours: [hrs('2026-03-01', 20)] });
    expect(r).toMatchObject({ status: 'on_track', windowStart: '2027-01-01' });
  });

  it('the grace boundary is inclusive and configurable', () => {
    expect(run({ today: '2027-01-30', hours })[0]!.status).toBe('overdue');
    expect(run({ today: '2027-01-31', hours })[0]!.status).toBe('on_track');
    expect(run({ today: '2027-01-31', hours, overdueGraceDays: 60 })[0]!.status).toBe('overdue');
  });

  it('a requirement that started after the previous window ended is never overdue for it', () => {
    const [r] = run({ requirements: [req({ effectiveFrom: '2027-01-01' })], today: '2027-01-10', hours });
    expect(r).toMatchObject({ status: 'on_track', windowStart: '2027-01-01' });
  });

  it('a requirement that started mid-year is judged on that year\'s whole window, earlier hours included', () => {
    const [r] = run({ requirements: [req({ effectiveFrom: '2026-07-01' })], today: '2027-01-10', hours });
    expect(r).toMatchObject({ status: 'overdue', earned: 12, windowEnd: '2026-12-31' });
  });
});

describe('who a requirement applies to', () => {
  const rank = req({ id: 'rank', rankId: 'ff' });
  const role = req({ id: 'role', roleId: 'medic' });
  const both = req({ id: 'both', rankId: 'ff', roleId: 'medic' });
  const everyone = req({ id: 'all' });
  const ids = (m: TrainingMember) =>
    trainingCompliance({ requirements: [rank, role, both, everyone], members: [m], hours: [], today: '2026-06-15' }).map((r) => r.requirementId).sort();

  it('rank and role requirements apply only to matching members; both must match together', () => {
    expect(ids(member({ rankId: 'ff' }))).toEqual(['all', 'rank']);
    expect(ids(member({ roleIds: ['medic'] }))).toEqual(['all', 'role']);
    expect(ids(member({ rankId: 'ff', roleIds: ['medic', 'other'] }))).toEqual(['all', 'both', 'rank', 'role']);
    expect(ids(member({ rankId: 'lt' }))).toEqual(['all']);
  });

  it('a member with no rank only gets everyone-requirements', () => {
    expect(ids(member())).toEqual(['all']);
  });
});

describe('effective dates', () => {
  it('a mid-year change uses the new requirement from its date and never the ended one', () => {
    const old = req({ id: 'old', requiredHours: 20, effectiveTo: '2026-06-30' });
    const next = req({ id: 'new', requiredHours: 24, effectiveFrom: '2026-07-01' });
    const before = trainingCompliance({ requirements: [old, next], members: [member()], hours: [], today: '2026-06-30' });
    expect(before.map((r) => r.requirementId)).toEqual(['old']);
    const after = trainingCompliance({ requirements: [old, next], members: [member()], hours: [hrs('2026-02-01', 10)], today: '2026-08-01' });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ requirementId: 'new', required: 24, earned: 10 });
  });

  it('a requirement that has not started yet produces no row', () => {
    expect(run({ requirements: [req({ effectiveFrom: '2026-07-01' })] })).toEqual([]);
  });

  it('returns a row per member and requirement', () => {
    const rows = trainingCompliance({
      requirements: [req(), req({ id: 'r2', categoryId: EMS })], members: [member(), member({ id: 'm2' })],
      hours: [hrs('2026-02-01', 20)], today: '2026-06-15',
    });
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.memberId === 'm1' && r.requirementId === 'r1')!.status).toBe('met');
    expect(rows.find((r) => r.memberId === 'm2' && r.requirementId === 'r1')!.status).toBe('on_track');
  });
});
