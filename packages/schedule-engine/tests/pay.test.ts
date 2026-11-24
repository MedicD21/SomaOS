import { describe, expect, it } from 'vitest';
import type { LeaveSegment, PayRules, WorkSegment, WorkType } from '../src/pay';
import { computePay, workPeriodOf } from '../src/pay';

const rules = (over: Partial<PayRules> = {}): PayRules => ({
  payPeriod: { kind: 'fixed_days', days: 14, anchor: '2026-01-01' },
  workPeriod: { days: 28, anchor: '2026-01-01', threshold: 212, multiplier: 1.5, code: 'OT' },
  overtimeCombination: 'highest',
  assignments: {
    regular: { code: 'REG', multiplier: 1 },
    overtime: { code: 'OTX', multiplier: 1.5 },
    trade: { code: 'REG', multiplier: 1 },
    holdover: { code: 'HOLD', multiplier: 1.5 },
    callback: { code: 'CALL', multiplier: 1.5, minimumHours: 2 },
    acting: { code: 'ACT', multiplier: 1 },
    training: { code: 'REG', multiplier: 1 },
    detail: { code: 'REG', multiplier: 1 },
  },
  compTime: { mode: 'never', multiplier: 1.5, bankKey: null },
  ...over,
});

const seg = (id: string, date: string, hours = 24, type: WorkType = 'regular'): WorkSegment => ({ id, date, hours, type });
const lv = (id: string, date: string, hours: number, counts: boolean): LeaveSegment => ({ id, date, hours, code: 'VAC', countsAsWorked: counts });
const ALL = { start: '2026-01-01', endExclusive: '2027-01-01' };
const run = (r: PayRules, segments: WorkSegment[], period = ALL, extra: Partial<Parameters<typeof computePay>[0]> = {}) =>
  computePay({ rules: r, hourlyRate: 20, prefersComp: false, segments, leave: [], period, ...extra });
const line = (res: ReturnType<typeof computePay>, code: string) => res.lines.find((l) => l.code === code);

// Ten 24 h shifts every third day: Jan 1,4,7,10,13 | 16,19,22,25,28
const TEN = ['01', '04', '07', '10', '13', '16', '19', '22', '25', '28'].map((d, i) => seg(`s${i + 1}`, `2026-01-${d}`));

describe('workPeriodOf', () => {
  const wp = rules().workPeriod;
  it('aligns to the anchor in blocks of N days', () => {
    expect(workPeriodOf(wp, '2026-01-28')).toEqual({ start: '2026-01-01', endExclusive: '2026-01-29' });
    expect(workPeriodOf(wp, '2026-01-29')).toEqual({ start: '2026-01-29', endExclusive: '2026-02-26' });
  });
  it('works for dates before the anchor', () => {
    expect(workPeriodOf(wp, '2025-12-31')).toEqual({ start: '2025-12-04', endExclusive: '2026-01-01' });
  });
});

describe('straight time', () => {
  it('pays regular hours below the threshold at the rate', () => {
    const r = run(rules(), TEN.slice(0, 3));
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ code: 'REG', multiplier: 1, hours: 72, rate: 20, amount: 1440, source: 'work' });
    expect(r.totalHours).toBe(72);
    expect(r.totalAmount).toBe(1440);
  });
});

describe('FLSA work period', () => {
  it('splits the shift that crosses the threshold exactly (20 h regular + 4 h overtime)', () => {
    const r = run(rules(), TEN, { start: '2026-01-25', endExclusive: '2026-01-29' });
    expect(line(r, 'REG')).toMatchObject({ hours: 20 });
    expect(line(r, 'OT')).toMatchObject({ hours: 28, multiplier: 1.5, amount: 840 });
    const why = line(r, 'OT')!.explain.map((e) => e.message).join(' ');
    expect(why).toContain('212');
    expect(why).toContain('2026-01-01');
  });

  it('a work period longer than the pay period shows overtime only where the threshold is crossed', () => {
    const first = run(rules(), TEN, { start: '2026-01-01', endExclusive: '2026-01-15' });
    expect(first.lines.map((l) => [l.code, l.hours])).toEqual([['REG', 120]]);
    const second = run(rules(), TEN, { start: '2026-01-15', endExclusive: '2026-01-29' });
    expect(second.lines.map((l) => [l.code, l.hours])).toEqual([['OT', 28], ['REG', 92]]);
  });

  it('resets the threshold in the next work period', () => {
    const next = [...TEN, seg('n1', '2026-01-29')];
    const r = run(rules(), next, { start: '2026-01-29', endExclusive: '2026-02-12' });
    expect(r.lines.map((l) => [l.code, l.hours])).toEqual([['REG', 24]]);
  });

  it('a non-FLSA assignment type is paid by contract but does not move the threshold', () => {
    const r0 = rules();
    const r1: PayRules = { ...r0, assignments: { ...r0.assignments, detail: { code: 'DET', multiplier: 1, countsTowardFlsa: false } } };
    const segs = [seg('a', '2026-01-02', 200), seg('b', '2026-01-03', 24, 'detail'), seg('c', '2026-01-04', 12)];
    const r = run(r1, segs);
    expect(line(r, 'DET')).toMatchObject({ hours: 24, multiplier: 1 });
    expect(line(r, 'OT')).toBeUndefined(); // 200 + 12 = 212, exactly at the threshold
  });
});

describe('combining contract and federal overtime', () => {
  const base = (over: Partial<PayRules>) => rules({ workPeriod: { days: 28, anchor: '2026-01-01', threshold: 24, multiplier: 1.5, code: 'OT' }, ...over });
  const segs = [seg('a', '2026-01-02', 24), seg('b', '2026-01-03', 10, 'overtime')];

  it('highest: the larger multiplier applies once; ties keep the contract code', () => {
    const r = run(base({}), segs);
    expect(line(r, 'OTX')).toMatchObject({ hours: 10, multiplier: 1.5, amount: 300 });
    expect(line(r, 'OT')).toBeUndefined();
  });

  it('stack: premiums add (1.5 + 0.5 = 2.0) and are coded as the federal overtime', () => {
    const r = run(base({ overtimeCombination: 'stack' }), segs);
    expect(line(r, 'OT')).toMatchObject({ hours: 10, multiplier: 2, amount: 400 });
  });

  it('below the threshold both policies pay the contract multiplier', () => {
    const wide = { days: 28, anchor: '2026-01-01', threshold: 1000, multiplier: 1.5, code: 'OT' };
    for (const mode of ['highest', 'stack'] as const) {
      const r = run(rules({ workPeriod: wide, overtimeCombination: mode }), segs);
      expect(line(r, 'OTX')).toMatchObject({ hours: 10, multiplier: 1.5 });
    }
  });

  it('highest: federal wins over straight time, contract wins when it is larger', () => {
    const r = run(base({ assignments: { ...rules().assignments, holdover: { code: 'HOLD', multiplier: 2 } } }), [
      seg('a', '2026-01-02', 24), seg('b', '2026-01-03', 5), seg('c', '2026-01-04', 4, 'holdover'),
    ]);
    expect(line(r, 'OT')).toMatchObject({ hours: 5, multiplier: 1.5 });
    expect(line(r, 'HOLD')).toMatchObject({ hours: 4, multiplier: 2 });
  });
});

describe('premium assignment types', () => {
  it('maps holdover and acting to their own codes', () => {
    const r = run(rules(), [seg('a', '2026-01-02', 6, 'holdover'), seg('b', '2026-01-03', 12, 'acting')]);
    expect(line(r, 'HOLD')).toMatchObject({ hours: 6, multiplier: 1.5, amount: 180 });
    expect(line(r, 'ACT')).toMatchObject({ hours: 12, multiplier: 1, amount: 240 });
  });

  it('tops a short callback up to the minimum without counting it as time worked', () => {
    const r0 = rules();
    const r1 = { ...r0, workPeriod: { ...r0.workPeriod, threshold: 25 } };
    const r = run(r1, [seg('a', '2026-01-02', 1, 'callback'), seg('b', '2026-01-03', 24)]);
    const calls = r.lines.filter((l) => l.code === 'CALL');
    expect(calls.map((l) => [l.source, l.hours])).toEqual([['callback_minimum', 1], ['work', 1]]);
    expect(line(r, 'OT')).toBeUndefined(); // 1 + 24 = 25 worked, at the threshold; the top-up did not count
    expect(r.totalHours).toBe(26);
  });
});

describe('leave', () => {
  const r0 = rules({ workPeriod: { days: 28, anchor: '2026-01-01', threshold: 48, multiplier: 1.5, code: 'OT' } });
  const worked = [seg('a', '2026-01-03'), seg('b', '2026-01-04')];

  it('leave that counts as worked raises the running total but is paid straight as its own code', () => {
    const r = run(r0, worked, ALL, { leave: [lv('l1', '2026-01-02', 24, true)] });
    expect(line(r, 'VAC')).toMatchObject({ hours: 24, multiplier: 1, source: 'leave', amount: 480 });
    expect(line(r, 'REG')).toMatchObject({ hours: 24 });
    expect(line(r, 'OT')).toMatchObject({ hours: 24 });
  });

  it('leave that does not count leaves the threshold alone', () => {
    const r = run(r0, worked, ALL, { leave: [lv('l1', '2026-01-02', 24, false)] });
    expect(line(r, 'VAC')).toMatchObject({ hours: 24 });
    expect(line(r, 'REG')).toMatchObject({ hours: 48 });
    expect(line(r, 'OT')).toBeUndefined();
  });
});

describe('comp time in lieu of overtime pay', () => {
  const base = (mode: PayRules['compTime']['mode']) =>
    rules({ workPeriod: { days: 28, anchor: '2026-01-01', threshold: 24, multiplier: 1.5, code: 'OT' }, compTime: { mode, multiplier: 1.5, bankKey: 'comp_time' } });
  const segs = [seg('a', '2026-01-02', 24), seg('b', '2026-01-03', 10, 'overtime')];

  it('always: overtime earns comp credit and no cash; straight time is still paid', () => {
    const r = run(base('always'), segs);
    expect(line(r, 'OTX')).toMatchObject({ hours: 10, compensated: true, amount: 0 });
    expect(r.comp).toEqual({ bankKey: 'comp_time', hours: 15 });
    expect(r.totalAmount).toBe(480);
  });

  it('member_choice follows the member', () => {
    const cash = run(base('member_choice'), segs, ALL, { prefersComp: false });
    expect(line(cash, 'OTX')).toMatchObject({ compensated: false, amount: 300 });
    expect(cash.comp.hours).toBe(0);
    const comp = run(base('member_choice'), segs, ALL, { prefersComp: true });
    expect(comp.comp.hours).toBe(15);
  });

  it('never: always cash', () => {
    const r = run(base('never'), segs);
    expect(line(r, 'OTX')).toMatchObject({ compensated: false, amount: 300 });
    expect(r.comp.hours).toBe(0);
  });
});

describe('rates, rounding and bad input', () => {
  it('no rate means no dollar amounts (null, not zero)', () => {
    const r = run(rules(), TEN.slice(0, 1), ALL, { hourlyRate: null });
    expect(r.lines[0]).toMatchObject({ hours: 24, rate: null, amount: null });
    expect(r.totalAmount).toBeNull();
    expect(r.totalHours).toBe(24);
  });

  it('rounds each line to cents', () => {
    const r = run(rules(), [seg('a', '2026-01-02', 7.5, 'holdover')], ALL, { hourlyRate: 23.4567 });
    expect(line(r, 'HOLD')!.amount).toBe(263.89);
    expect(r.totalAmount).toBe(263.89);
  });

  it('names the missing assignment type', () => {
    const r0 = rules();
    const { detail: _removed, ...rest } = r0.assignments;
    expect(() => run({ ...r0, assignments: rest as PayRules['assignments'] }, [seg('a', '2026-01-02', 8, 'detail')])).toThrow(
      'Pay rules have no code for assignment type "detail"',
    );
  });

  it('ignores zero-hour segments and segments outside the pay period for output', () => {
    const r = run(rules(), [seg('z', '2026-01-02', 0), seg('o', '2025-12-30', 24)], { start: '2026-01-01', endExclusive: '2026-01-15' });
    expect(r.lines).toEqual([]);
    expect(r.totalHours).toBe(0);
  });
});
