import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalHash, signSimulation, verifySimulation } from '@/server/rules/sim-token';

const base = { tenantId: 't1', kind: 'pay.rules', key: 'default', version: 3, userId: 'u1' };
const draft = { a: 1, b: { c: [1, 2] } };

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.SOMA_SIM_TOKEN_SECRET;
  process.env.SOMA_SIM_TOKEN_SECRET = 'test-secret-with-enough-length-0123456789';
});
afterEach(() => {
  if (saved === undefined) delete process.env.SOMA_SIM_TOKEN_SECRET;
  else process.env.SOMA_SIM_TOKEN_SECRET = saved;
});

describe('canonicalHash', () => {
  it('ignores key order and whitespace but not values', () => {
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
    expect(canonicalHash({ a: 1, b: 2 })).not.toBe(canonicalHash({ a: 1, b: 3 }));
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
  });
});

describe('simulation token', () => {
  const now = new Date('2026-03-01T12:00:00Z');

  it('verifies for the exact draft, user and key', () => {
    const t = signSimulation({ ...base, payload: draft, summary: 'period 2026-01-01', now });
    const r = verifySimulation(t, { ...base, payload: draft, now: new Date(now.getTime() + 60_000) });
    expect(r).toMatchObject({ ok: true, summary: 'period 2026-01-01' });
  });

  it('is refused when the draft changed after simulating', () => {
    const t = signSimulation({ ...base, payload: draft, summary: 's', now });
    expect(verifySimulation(t, { ...base, payload: { ...draft, a: 2 }, now })).toEqual({ ok: false, reason: 'changed' });
  });

  it('is refused for another user, version, key, kind or tenant', () => {
    const t = signSimulation({ ...base, payload: draft, summary: 's', now });
    for (const other of [{ userId: 'u2' }, { version: 4 }, { key: 'other' }, { kind: 'leave.accrual' }, { tenantId: 't2' }]) {
      expect(verifySimulation(t, { ...base, ...other, payload: draft, now })).toEqual({ ok: false, reason: 'changed' });
    }
  });

  it('expires after 30 minutes', () => {
    const t = signSimulation({ ...base, payload: draft, summary: 's', now });
    expect(verifySimulation(t, { ...base, payload: draft, now: new Date(now.getTime() + 31 * 60_000) })).toEqual({ ok: false, reason: 'expired' });
  });

  it('is refused when missing, malformed or forged', () => {
    expect(verifySimulation('', { ...base, payload: draft, now })).toEqual({ ok: false, reason: 'missing' });
    expect(verifySimulation('nonsense', { ...base, payload: draft, now })).toEqual({ ok: false, reason: 'invalid' });
    const t = signSimulation({ ...base, payload: draft, summary: 's', now });
    const [body] = t.split('.');
    expect(verifySimulation(`${body}.AAAA`, { ...base, payload: draft, now })).toEqual({ ok: false, reason: 'invalid' });
    // A body edited to claim another user fails the signature.
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), u: 'u2' })).toString('base64url');
    expect(verifySimulation(`${forged}.${t.split('.')[1]}`, { ...base, userId: 'u2', payload: draft, now })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('fails closed without a secret', () => {
    delete process.env.SOMA_SIM_TOKEN_SECRET;
    const dbUrl = process.env.SOMA_DB_URL;
    delete process.env.SOMA_DB_URL;
    try {
      expect(() => signSimulation({ ...base, payload: draft, summary: 's', now })).toThrow(/secret/i);
      expect(verifySimulation('a.b', { ...base, payload: draft, now })).toEqual({ ok: false, reason: 'invalid' });
    } finally {
      if (dbUrl !== undefined) process.env.SOMA_DB_URL = dbUrl;
    }
  });

  it('a token for one secret is useless under another', () => {
    const t = signSimulation({ ...base, payload: draft, summary: 's', now });
    process.env.SOMA_SIM_TOKEN_SECRET = 'a-completely-different-secret-9876543210';
    expect(verifySimulation(t, { ...base, payload: draft, now })).toEqual({ ok: false, reason: 'invalid' });
  });
});
