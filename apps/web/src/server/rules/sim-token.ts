import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Proof that a specific draft was simulated by a specific person. Stateless: an HMAC over
 * (tenant, kind, key, version, hash of the draft, user, expiry), so no table is needed and
 * editing the draft invalidates the token by construction.
 *
 * Secret: `SOMA_SIM_TOKEN_SECRET` if set, otherwise derived from `SOMA_DB_URL` (server-only and secret in
 * every deployment: it carries the database password). With neither, signing throws and verifying refuses.
 */

const TTL_MS = 30 * 60_000;

function secret(): string | null {
  const explicit = process.env.SOMA_SIM_TOKEN_SECRET;
  if (explicit && explicit.length >= 16) return explicit;
  const db = process.env.SOMA_DB_URL;
  if (db) return createHash('sha256').update(`soma-sim-token:${db}`).digest('hex');
  return null;
}

/** JSON with object keys sorted, so equal documents hash equally whatever their key order. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export const canonicalHash = (v: unknown): string => createHash('sha256').update(canonical(v)).digest('hex');

export type SimBinding = { tenantId: string; kind: string; key: string; version: number; userId: string; payload: unknown; now?: Date };

type Body = { t: string; k: string; key: string; v: number; h: string; u: string; iat: number; exp: number; s: string };

const hmac = (sec: string, body: string): string => createHmac('sha256', sec).update(body).digest('base64url');

export function signSimulation(b: SimBinding & { summary: string }): string {
  const sec = secret();
  if (!sec) throw new Error('No simulation token secret is configured (set SOMA_SIM_TOKEN_SECRET).');
  const now = (b.now ?? new Date()).getTime();
  const body: Body = {
    t: b.tenantId, k: b.kind, key: b.key, v: b.version, h: canonicalHash(b.payload), u: b.userId,
    iat: now, exp: now + TTL_MS, s: b.summary.slice(0, 200),
  };
  const enc = Buffer.from(JSON.stringify(body)).toString('base64url');
  return `${enc}.${hmac(sec, enc)}`;
}

export type SimVerdict =
  | { ok: true; summary: string; ref: string; simulatedAt: Date }
  | { ok: false; reason: 'missing' | 'invalid' | 'changed' | 'expired' };

export function verifySimulation(token: string, b: SimBinding): SimVerdict {
  if (!token) return { ok: false, reason: 'missing' };
  const sec = secret();
  const [enc, sig, extra] = token.split('.');
  if (!sec || !enc || !sig || extra !== undefined) return { ok: false, reason: 'invalid' };
  const want = Buffer.from(hmac(sec, enc));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: 'invalid' };
  let body: Body;
  try {
    body = JSON.parse(Buffer.from(enc, 'base64url').toString()) as Body;
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  const bound =
    body.t === b.tenantId && body.k === b.kind && body.key === b.key && body.v === b.version && body.u === b.userId &&
    body.h === canonicalHash(b.payload);
  if (!bound) return { ok: false, reason: 'changed' };
  if ((b.now ?? new Date()).getTime() > body.exp) return { ok: false, reason: 'expired' };
  return { ok: true, summary: body.s, ref: sig.slice(0, 8), simulatedAt: new Date(body.iat) };
}
