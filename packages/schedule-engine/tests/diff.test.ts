import { describe, expect, it } from 'vitest';
import { diffConfig } from '../src/diff';

describe('diffConfig', () => {
  it('returns nothing for identical documents', () => {
    expect(diffConfig({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 2] } })).toEqual([]);
  });

  it('lists changed leaves with dotted paths in a stable order', () => {
    const before = { workPeriod: { threshold: 212, code: 'ot' }, compTime: { mode: 'never' } };
    const after = { workPeriod: { threshold: 200, code: 'ot' }, compTime: { mode: 'always' } };
    expect(diffConfig(before, after)).toEqual([
      { path: 'compTime.mode', before: 'never', after: 'always' },
      { path: 'workPeriod.threshold', before: 212, after: 200 },
    ]);
  });

  it('matches array items by index and reports added and removed items', () => {
    const before = { tiers: [{ fromYears: 0, hours: 8 }, { fromYears: 5, hours: 12 }] };
    const after = { tiers: [{ fromYears: 0, hours: 8 }, { fromYears: 5, hours: 14 }, { fromYears: 10, hours: 16 }] };
    expect(diffConfig(before, after)).toEqual([
      { path: 'tiers.1.hours', before: 12, after: 14 },
      { path: 'tiers.2', before: undefined, after: { fromYears: 10, hours: 16 } },
    ]);
    expect(diffConfig(after, before)).toEqual([
      { path: 'tiers.1.hours', before: 14, after: 12 },
      { path: 'tiers.2', before: { fromYears: 10, hours: 16 }, after: undefined },
    ]);
  });

  it('treats a missing first version as everything added', () => {
    expect(diffConfig(null, { a: 1, b: { c: 2 } })).toEqual([
      { path: 'a', before: undefined, after: 1 },
      { path: 'b.c', before: undefined, after: 2 },
    ]);
  });

  it('reports key changes and null transitions', () => {
    expect(diffConfig({ cap: null, x: 1 } as Record<string, unknown>, { cap: 240 } as Record<string, unknown>)).toEqual([
      { path: 'cap', before: null, after: 240 },
      { path: 'x', before: 1, after: undefined },
    ]);
  });
});
