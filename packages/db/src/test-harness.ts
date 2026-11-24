import type postgres from 'postgres';
import { createSql } from './client';

export type TestClaims = { sub: string; tenant_id?: string | null };
export type Tx = postgres.TransactionSql;

let sql: postgres.Sql | null = null;
const db = (): postgres.Sql => (sql ??= createSql());

class Rollback extends Error {
  constructor(public readonly value: unknown) {
    super('rollback');
  }
}

/** Runs fn in a transaction that is always rolled back. */
async function inRolledBackTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    await db().begin(async (tx) => {
      throw new Rollback(await fn(tx));
    });
  } catch (e) {
    if (e instanceof Rollback) return e.value as T;
    throw e;
  }
  throw new Error('unreachable');
}

/** Superuser transaction (bypasses RLS); always rolled back. */
export function withAdmin<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inRolledBackTx(fn);
}

/** Switches to the `authenticated` role with the given JWT claims for the duration of fn. */
export async function asUser<T>(tx: Tx, claims: TestClaims, fn: () => Promise<T>): Promise<T> {
  const json = JSON.stringify({ role: 'authenticated', ...claims });
  await tx`select set_config('request.jwt.claims', ${json}, true)`;
  await tx`set local role authenticated`;
  try {
    return await fn();
  } finally {
    await tx`reset role`;
  }
}

/** Transaction as an authenticated user with the given claims; always rolled back. */
export function withUser<T>(claims: TestClaims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inRolledBackTx((tx) => asUser(tx, claims, () => fn(tx)));
}

/** Inserts a minimal auth.users row and returns its id. Must run as superuser. */
export async function createTestUser(tx: Tx, email?: string): Promise<string> {
  const rows = await tx<{ id: string }[]>`
    insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            ${email ?? `user-${crypto.randomUUID()}@test.local`}, '{}', '{}', now(), now())
    returning id`;
  return rows[0]!.id;
}

/**
 * Asserts that fn fails with an error matching pattern, inside a savepoint so the
 * surrounding test transaction stays usable.
 */
export async function expectDbError(tx: Tx, pattern: RegExp, fn: () => Promise<unknown>): Promise<void> {
  let error: unknown = null;
  try {
    await tx.savepoint(async () => {
      await fn();
    });
  } catch (e) {
    error = e;
  }
  if (!error) throw new Error(`expected database error matching ${pattern}, but call succeeded`);
  const message = error instanceof Error ? error.message : String(error);
  if (!pattern.test(message)) throw new Error(`expected error matching ${pattern}, got: ${message}`);
}

export async function closeTestDb(): Promise<void> {
  await sql?.end();
  sql = null;
}
