import { describe, expect, it } from 'vitest';
import type { ConfigVersion } from '@soma/config-core';
import {
  planRegularRoster,
  startOfLocalDay,
  localToInstant,
  type ShiftPattern,
  type StandingSeat,
} from '../src/index';

const tz = 'America/Chicago';
const p24: ShiftPattern = {
  cycle: ['on', 'off', 'off'],
  shiftStart: '07:00',
  shiftHours: 24,
  anchorDate: '2026-01-01',
  platoons: { a: 0, b: 1, c: 2 },
  kelly: { everyNthShift: 9 },
};

const v1: ConfigVersion<ShiftPattern> = {
  kind: 'shift_pattern',
  key: 'p24',
  version: 1,
  effectiveFrom: startOfLocalDay('2026-01-01', tz),
  effectiveTo: startOfLocalDay('2026-12-15', tz),
  payload: p24,
};
const v2: ConfigVersion<ShiftPattern> = {
  ...v1,
  version: 2,
  effectiveFrom: startOfLocalDay('2026-12-15', tz),
  effectiveTo: null,
  payload: { ...p24, shiftStart: '08:00' },
};

const seat = (over: Partial<StandingSeat> = {}): StandingSeat => ({
  memberId: 'm1',
  seatId: 'S1',
  platoon: 'a',
  kellyGroup: 0,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  tz,
  ...over,
});

const members = [{ memberId: 'm1', separatedOn: null }];

describe('planRegularRoster', () => {
  it('marks Kelly shifts with no seat', () => {
    const rows = planRegularRoster({
      patterns: [v1, v2],
      standing: [seat()],
      members,
      from: '2026-01-01',
      toExclusive: '2026-02-01',
    });
    expect(rows).toHaveLength(11);
    const kelly = rows.filter((r) => r.type === 'kelly');
    expect(kelly.map((r) => r.date)).toEqual(['2026-01-01', '2026-01-28']);
    expect(kelly.every((r) => r.seatId === null)).toBe(true);
    const regular = rows.filter((r) => r.type === 'regular');
    expect(regular).toHaveLength(9);
    expect(regular.every((r) => r.seatId === 'S1')).toBe(true);
  });

  it('selects pattern version by shift date', () => {
    const rows = planRegularRoster({
      patterns: [v1, v2],
      standing: [seat()],
      members,
      from: '2026-12-12',
      toExclusive: '2026-12-20',
    });
    expect(rows.map((r) => [r.date, r.patternVersion])).toEqual([
      ['2026-12-12', 1],
      ['2026-12-15', 2],
      ['2026-12-18', 2],
    ]);
    expect(rows[0]!.start).toEqual(localToInstant('2026-12-12', '07:00', tz));
    expect(rows[1]!.start).toEqual(localToInstant('2026-12-15', '08:00', tz));
    expect(rows[0]!.explain[0]!.rule).toBe('pattern');
    expect(rows[0]!.explain[0]!.message).toContain('v1');
    expect(rows[1]!.explain[0]!.message).toContain('v2');
  });

  it('switches standing seats on effective date', () => {
    const rows = planRegularRoster({
      patterns: [v1],
      standing: [
        seat({ seatId: 'S1', effectiveTo: '2026-01-10', kellyGroup: null }),
        seat({ seatId: 'S2', effectiveFrom: '2026-01-10', kellyGroup: null }),
      ],
      members,
      from: '2026-01-01',
      toExclusive: '2026-01-20',
    });
    expect(rows.map((r) => [r.date, r.seatId])).toEqual([
      ['2026-01-01', 'S1'],
      ['2026-01-04', 'S1'],
      ['2026-01-07', 'S1'],
      ['2026-01-10', 'S2'],
      ['2026-01-13', 'S2'],
      ['2026-01-16', 'S2'],
      ['2026-01-19', 'S2'],
    ]);
  });

  it('gives separated members nothing on or after separation', () => {
    const rows = planRegularRoster({
      patterns: [v1],
      standing: [seat({ kellyGroup: null })],
      members: [{ memberId: 'm1', separatedOn: '2026-01-05' }],
      from: '2026-01-01',
      toExclusive: '2026-01-20',
    });
    expect(rows.map((r) => r.date)).toEqual(['2026-01-01', '2026-01-04']);
  });

  it('returns no rows where no pattern is effective', () => {
    const rows = planRegularRoster({
      patterns: [v1],
      standing: [seat({ effectiveFrom: '2025-12-01' })],
      members,
      from: '2025-12-01',
      toExclusive: '2026-01-02',
    });
    expect(rows.map((r) => r.date)).toEqual(['2026-01-01']);
    expect(
      planRegularRoster({ patterns: [], standing: [seat()], members, from: '2026-01-01', toExclusive: '2026-02-01' }),
    ).toEqual([]);
  });

  it('skips pattern versions outside the range even if they lack the platoon', () => {
    const v2ab: ConfigVersion<ShiftPattern> = {
      ...v2,
      payload: { ...v2.payload, platoons: { a: 0, b: 1 } },
    };
    const rows = planRegularRoster({
      patterns: [v1, v2ab],
      standing: [seat({ platoon: 'c', kellyGroup: null })],
      members,
      from: '2026-12-01',
      toExclusive: '2026-12-15',
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.patternVersion === 1)).toBe(true);
  });

  it('does not expand a version past its local end date', () => {
    const v2d: ConfigVersion<ShiftPattern> = {
      ...v2,
      payload: { ...v2.payload, platoons: { a: 0, b: 1, c: 2, d: 1 } },
    };
    const rows = planRegularRoster({
      patterns: [v1, v2d],
      standing: [seat({ platoon: 'd', kellyGroup: null, effectiveFrom: '2026-12-15' })],
      members,
      from: '2026-12-10',
      toExclusive: '2026-12-20',
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.patternVersion === 2 && r.date >= '2026-12-15')).toBe(true);
  });
});
