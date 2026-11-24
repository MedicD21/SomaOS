import 'server-only';
import postgres from 'postgres';

const globalForDb = globalThis as { __somaSql?: postgres.Sql };

/** Server-only Postgres pool. Every query runs through withUserDb so RLS applies. */
const sql = (globalForDb.__somaSql ??= postgres(process.env.SOMA_DB_URL!, {
  max: 10,
  onnotice: () => undefined,
}));

export type Tx = postgres.TransactionSql;
export type DbClaims = { sub: string; tenant_id?: string | null } & Record<string, unknown>;

/**
 * Runs fn in a transaction as Postgres role `authenticated` with the caller's verified
 * JWT claims, so row-level security and auth.uid()/app.tenant_id() behave exactly as for
 * the signed-in user.
 */
export async function withUserDb<T>(claims: DbClaims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const json = JSON.stringify({ ...claims, role: 'authenticated' });
  return (await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${json}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  })) as T;
}
