import { describe, expect, it } from 'vitest';
import type { ConfigVersion } from '../src/resolve';
import { resolveEffective, resolveLayered } from '../src/resolve';

const v = (version: number, from: string, to: string | null): ConfigVersion<{ n: number }> => ({
  kind: 'pay',
  key: 'ot',
  version,
  effectiveFrom: new Date(from),
  effectiveTo: to ? new Date(to) : null,
  payload: { n: version },
});

describe('resolveEffective', () => {
  const versions = [v(1, '2026-01-01T00:00:00Z', '2026-07-01T00:00:00Z'), v(2, '2026-07-01T00:00:00Z', null)];

  it('picks the version whose [from, to) contains the instant', () => {
    expect(resolveEffective(versions, new Date('2026-03-01T00:00:00Z'))?.version).toBe(1);
    expect(resolveEffective(versions, new Date('2027-03-01T00:00:00Z'))?.version).toBe(2);
  });

  it('excludes the upper bound', () => {
    expect(resolveEffective(versions, new Date('2026-07-01T00:00:00Z'))?.version).toBe(2);
  });

  it('returns null when nothing is effective', () => {
    expect(resolveEffective(versions, new Date('2025-12-31T23:59:59Z'))).toBeNull();
  });
});

describe('resolveLayered', () => {
  type Ot = { ot: { threshold: number; periodDays: number }; codes: string[] };

  it('deep-merges objects, later layers win, and reports sources per leaf', () => {
    const r = resolveLayered<Ot>([
      { name: 'platform', payload: { ot: { threshold: 212, periodDays: 28 }, codes: ['REG', 'OT'] } },
      { name: 'tenant', payload: { ot: { threshold: 204 } as Ot['ot'] } },
    ]);
    expect(r.value).toEqual({ ot: { threshold: 204, periodDays: 28 }, codes: ['REG', 'OT'] });
    expect(r.sources).toEqual({ 'ot.threshold': 'tenant', 'ot.periodDays': 'platform', codes: 'platform' });
  });

  it('replaces arrays rather than merging them', () => {
    const r = resolveLayered<Ot>([
      { name: 'platform', payload: { codes: ['REG', 'OT'] } },
      { name: 'tenant', payload: { codes: ['REG'] } },
    ]);
    expect(r.value.codes).toEqual(['REG']);
    expect(r.sources.codes).toBe('tenant');
  });
});
