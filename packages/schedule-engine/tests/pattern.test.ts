import { describe, expect, it } from 'vitest';
import { expandPattern, isKellyShift, type ShiftPattern } from '../src/index';

const tz = 'America/Chicago';
const p24: ShiftPattern = {
  cycle: ['on', 'off', 'off'],
  shiftStart: '07:00',
  shiftHours: 24,
  anchorDate: '2026-01-01',
  platoons: { a: 0, b: 1, c: 2 },
  kelly: { everyNthShift: 9 },
};

describe('expandPattern', () => {
  it('expands platoon dates', () => {
    expect(expandPattern(p24, 'a', '2026-01-01', '2026-01-10', tz).map((s) => s.date)).toEqual([
      '2026-01-01',
      '2026-01-04',
      '2026-01-07',
    ]);
    expect(expandPattern(p24, 'b', '2026-01-01', '2026-01-10', tz).map((s) => s.date)).toEqual([
      '2026-01-02',
      '2026-01-05',
      '2026-01-08',
    ]);
  });

  it('computes first shift instants', () => {
    const [s] = expandPattern(p24, 'a', '2026-01-01', '2026-01-02', tz);
    expect(s?.start.toISOString()).toBe('2026-01-01T13:00:00.000Z');
    expect(s?.hours).toBe(24);
    expect(s?.index).toBe(0);
  });

  it('gives 23h and 25h shifts across DST', () => {
    const all = ['a', 'b', 'c'].flatMap((k) =>
      expandPattern(p24, k, '2026-03-01', '2026-11-05', tz),
    );
    expect(all.find((s) => s.date === '2026-03-07')?.hours).toBe(23);
    expect(all.find((s) => s.date === '2026-10-31')?.hours).toBe(25);
  });

  it('resolves nonexistent local times forward', () => {
    const p = { ...p24, shiftStart: '02:30', anchorDate: '2026-03-08' };
    const [s] = expandPattern(p, 'a', '2026-03-08', '2026-03-09', tz);
    expect(s?.start.toISOString()).toBe('2026-03-08T08:30:00.000Z');
  });

  it('handles dates before the anchor', () => {
    const r = expandPattern(p24, 'a', '2025-12-26', '2026-01-01', tz);
    expect(r.map((s) => s.date)).toEqual(['2025-12-26', '2025-12-29']);
    expect(r.map((s) => s.index)).toEqual([-2, -1]);
  });
});

describe('isKellyShift', () => {
  it('matches index modulo', () => {
    expect(isKellyShift(p24, 9, 0)).toBe(true);
    expect(isKellyShift(p24, 10, 0)).toBe(false);
    expect(isKellyShift(p24, 10, 1)).toBe(true);
    expect(isKellyShift(p24, 9, null)).toBe(false);
    expect(isKellyShift({ ...p24, kelly: undefined }, 9, 0)).toBe(false);
  });
});
