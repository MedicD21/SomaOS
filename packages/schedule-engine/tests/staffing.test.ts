import { describe, expect, it } from 'vitest';
import {
  evaluateStaffing,
  mandateCandidates,
  memberGroups,
  suggestTransfers,
  type OnDuty,
  type StaffingRules,
  type StaffingUnit,
  type StaffingWindow,
} from '../src/staffing';

const TZ = 'America/New_York';

const RULES: StaffingRules = {
  groups: [{ key: 'als', label: 'ALS', credentialKeys: ['paramedic', 'aemt'] }],
  departmentMinimums: [{ group: 'als', min: 5 }],
  unitRules: [{ group: 'als', unitTypeKey: 'unit', min: 2 }],
};

// Operational day 06:00 to 06:00 local (EST = UTC-5).
const at = (hhmm: string, nextDay = false) => new Date(`2027-01-${nextDay ? '06' : '05'}T${hhmm}:00-05:00`);
const WINDOW: StaffingWindow = { start: at('06:00'), end: at('06:00', true), tz: TZ };

const unit = (id: string, typeKey = 'unit'): StaffingUnit => ({ id, name: `Medic ${id}`, typeKey });

let n = 0;
function duty(unitId: string, als: boolean, opts: Partial<OnDuty> = {}): OnDuty {
  n += 1;
  return {
    memberId: `m${n}`,
    memberName: `Member ${n}`,
    unitId,
    seatId: `s${n}`,
    seatLabel: `Seat ${n}`,
    seatSort: n,
    seatHasMinRank: false,
    groups: als ? ['als'] : [],
    start: WINDOW.start,
    end: WINDOW.end,
    ...opts,
  };
}

describe('memberGroups', () => {
  const shiftEnd = new Date('2027-04-01T10:00:00Z'); // 06:00 local on Apr 1

  it('counts a member holding any credential of the group', () => {
    expect(memberGroups(RULES, [{ key: 'aemt', expiresOn: null }], shiftEnd, TZ)).toEqual(['als']);
    expect(memberGroups(RULES, [{ key: 'emt', expiresOn: null }], shiftEnd, TZ)).toEqual([]);
  });

  it('needs the credential valid through the end of the shift', () => {
    expect(memberGroups(RULES, [{ key: 'paramedic', expiresOn: '2027-03-31' }], shiftEnd, TZ)).toEqual([]);
    expect(memberGroups(RULES, [{ key: 'paramedic', expiresOn: '2027-04-01' }], shiftEnd, TZ)).toEqual(['als']);
  });
});

describe('evaluateStaffing', () => {
  it('counts distinct members against the department minimum and each unit rule', () => {
    const units = [unit('1'), unit('2'), unit('cap', 'command')];
    const onDuty = [
      duty('1', true), duty('1', true), duty('1', false),
      duty('2', true), duty('2', false),
      duty('cap', true),
    ];
    const ev = evaluateStaffing(RULES, units, onDuty, WINDOW);
    expect(ev.department[0]).toMatchObject({ group: 'als', label: 'ALS', min: 5, count: 4, met: false, shortfall: 1 });
    expect(ev.department[0]!.gaps).toEqual([{ from: WINDOW.start, to: WINDOW.end, count: 4 }]);
    expect(ev.met).toBe(false);
    const u1 = ev.units.find((u) => u.unitId === '1')!;
    const u2 = ev.units.find((u) => u.unitId === '2')!;
    const cap = ev.units.find((u) => u.unitId === 'cap')!;
    expect(u1.checks[0]).toMatchObject({ min: 2, count: 2, met: true, gaps: [] });
    expect(u2.checks[0]).toMatchObject({ count: 1, met: false });
    expect(u2.violations[0]!.rule).toBe('staffing.unit_below_minimum');
    // The unit rule applies only to units of its type.
    expect(cap.checks).toEqual([]);
    expect(ev.violations.map((v) => v.rule).sort()).toEqual(['staffing.department_below_minimum', 'staffing.unit_below_minimum']);
  });

  it('flags a 20-minute dip below the minimum, with its local times', () => {
    const onDuty = [
      duty('1', true), duty('1', true), duty('2', true), duty('2', true),
      // The fifth ALS leaves at 12:00 and the relief arrives at 12:20.
      duty('2', true, { end: at('12:00') }),
      duty('2', true, { start: at('12:20') }),
    ];
    const ev = evaluateStaffing(RULES, [unit('1'), unit('2')], onDuty, WINDOW);
    expect(ev.department[0]).toMatchObject({ count: 4, met: false, shortfall: 1 });
    expect(ev.department[0]!.gaps).toEqual([{ from: at('12:00'), to: at('12:20'), count: 4 }]);
    expect(ev.violations[0]!.message).toBe('ALS below the department minimum of 5: 12:00–12:20 (4 on duty)');
  });

  it('counts split seats (06–12 then 12–06) as continuous cover', () => {
    const onDuty = [
      duty('1', true), duty('2', true), duty('2', true), duty('1', true),
      duty('1', true, { end: at('12:00') }),
      duty('1', true, { start: at('12:00') }),
    ];
    const ev = evaluateStaffing(RULES, [unit('1'), unit('2')], onDuty, WINDOW);
    expect(ev.department[0]).toMatchObject({ count: 5, met: true, gaps: [] });
    expect(ev.met).toBe(true);
  });

  it('counts the previous day’s crew until it is relieved', () => {
    const lateRelief = [duty('1', true, { start: at('06:00'), end: at('06:00', true) })];
    const overnight = duty('1', true, { start: new Date(WINDOW.start.getTime() - 86_400_000), end: WINDOW.start });
    const ev = evaluateStaffing({ ...RULES, departmentMinimums: [] }, [unit('1')], [...lateRelief, overnight], WINDOW);
    // The overnight shift ends exactly when the window opens: it does not count.
    expect(ev.units[0]!.checks[0]).toMatchObject({ count: 1, met: false });
  });

  it('counts a member once even when on two seats', () => {
    const a = duty('1', true);
    const ev = evaluateStaffing(RULES, [unit('1')], [a, { ...a, seatId: 'other' }], WINDOW);
    expect(ev.department[0]!.count).toBe(1);
    expect(ev.units[0]!.checks[0]!.count).toBe(1);
  });

  it('flags a unit of the rule type with nobody on it', () => {
    const ev = evaluateStaffing(RULES, [unit('1')], [], WINDOW);
    expect(ev.units[0]!.checks[0]).toMatchObject({ count: 0, met: false });
  });

  it('is met with no rules', () => {
    const ev = evaluateStaffing({ groups: [], departmentMinimums: [], unitRules: [] }, [unit('1')], [duty('1', true)], WINDOW);
    expect(ev.met).toBe(true);
    expect(ev.violations).toEqual([]);
  });
});

describe('suggestTransfers', () => {
  it('moves an ALS member from a unit with a surplus when the department is at minimum', () => {
    const units = [unit('1'), unit('2'), unit('3')];
    const lt = duty('1', true, { seatHasMinRank: true, seatSort: 1 });
    const p1 = duty('1', true, { seatSort: 2 });
    const p2 = duty('1', true, { seatSort: 3 });
    const onDuty = [lt, p1, p2, duty('2', true), duty('2', false), duty('3', true), duty('3', true)];
    const tts = suggestTransfers(RULES, units, onDuty, WINDOW);
    expect(tts).toHaveLength(1);
    // The officer's seat is kept; the highest seat goes.
    expect(tts[0]).toMatchObject({ group: 'als', fromUnitId: '1', toUnitId: '2', memberId: p2.memberId });
  });

  it('never takes a donor below its minimum', () => {
    const units = [unit('1'), unit('2'), unit('3')];
    const onDuty = [
      duty('1', true), duty('1', true), duty('1', true),
      duty('2', false), duty('2', false),
      duty('3', true), duty('3', true),
    ];
    const tts = suggestTransfers(RULES, units, onDuty, WINDOW);
    expect(tts).toHaveLength(1);
    expect(tts[0]!.fromUnitId).toBe('1');
  });

  it('never takes a donor below its minimum at any moment', () => {
    // Unit 1 has a third ALS only until 12:00; its third member for the afternoon is an EMT.
    const units = [unit('1'), unit('2')];
    const onDuty = [
      duty('1', true), duty('1', true), duty('1', true, { end: at('12:00') }),
      duty('2', true),
    ];
    const tts = suggestTransfers({ ...RULES, departmentMinimums: [] }, units, onDuty, WINDOW);
    // Moving a full-day member would leave unit 1 with 1 ALS after 12:00; only the morning member can go.
    expect(tts).toHaveLength(1);
    expect(tts[0]!.memberId).toBe(onDuty[2]!.memberId);
  });

  it('suggests nothing while the department dips below its minimum', () => {
    const units = [unit('1'), unit('2')];
    const onDuty = [duty('1', true), duty('1', true), duty('1', true), duty('2', true), duty('2', true, { end: at('23:40') })];
    expect(suggestTransfers(RULES, units, onDuty, WINDOW)).toEqual([]);
  });

  it('takes from the donor with the biggest surplus first', () => {
    const units = [unit('1'), unit('2'), unit('3')];
    const onDuty = [
      duty('1', true), duty('1', true), duty('1', true),
      duty('2', true), duty('2', true), duty('2', true), duty('2', true),
      duty('3', false),
    ];
    const rules = { ...RULES, departmentMinimums: [{ group: 'als', min: 7 }] };
    const tts = suggestTransfers(rules, units, onDuty, WINDOW);
    expect(tts.map((t) => t.fromUnitId)).toEqual(['2', '1']);
    expect(new Set(tts.map((t) => t.memberId)).size).toBe(2);
  });
});

describe('mandateCandidates', () => {
  const entries = [
    { memberId: 'a', name: 'A', position: 1, exemptReason: 'Light duty', exemptUntil: null },
    { memberId: 'b', name: 'B', position: 2, exemptReason: null, exemptUntil: null },
    { memberId: 'c', name: 'C', position: 3, exemptReason: 'FMLA', exemptUntil: '2027-01-01' },
    { memberId: 'd', name: 'D', position: 4, exemptReason: null, exemptUntil: null },
    { memberId: 'e', name: 'E', position: 5, exemptReason: null, exemptUntil: null },
    { memberId: 'f', name: 'F', position: 6, exemptReason: null, exemptUntil: null },
    { memberId: 'g', name: 'G', position: 7, exemptReason: null, exemptUntil: null },
    { memberId: 'h', name: 'H', position: 8, exemptReason: null, exemptUntil: null },
  ];
  const ctx = {
    date: '2027-01-02',
    working: new Set(['b']),
    onLeave: new Set(['d']),
    qualified: new Set(['a', 'b', 'c', 'd', 'f', 'g', 'h']),
    separated: new Set(['h']),
    skipped: new Set(['f']),
  };

  it('gives every member a status in list order', () => {
    const list = mandateCandidates(entries, ctx);
    expect(list.map((c) => [c.memberId, c.status])).toEqual([
      ['a', 'exempt'],
      ['b', 'working'],
      ['c', 'eligible'], // exemption ended 2027-01-01
      ['d', 'on_leave'],
      ['e', 'not_qualified'],
      ['f', 'skipped'],
      ['g', 'eligible'],
      ['h', 'separated'],
    ]);
    expect(list[0]!.reason).toBe('Light duty');
  });

  it('orders by position, not input order', () => {
    const list = mandateCandidates([...entries].reverse(), ctx);
    expect(list[0]!.memberId).toBe('a');
  });
});
