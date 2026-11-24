import type { Tx } from '../src/test-harness';
import { createTestUser } from '../src/test-harness';

export async function createTenant(tx: Tx, name = 'Test FD', timezone = 'America/Chicago'): Promise<string> {
  const slug = `t-${crypto.randomUUID().slice(0, 8)}`;
  const rows = await tx<{ id: string }[]>`
    select app.create_tenant(${name}, ${slug}, ${timezone}, 'career', 'TX') as id`;
  return rows[0]!.id;
}

export async function addMembership(
  tx: Tx,
  tenantId: string,
  userId: string,
  status: 'active' | 'invited' | 'suspended' | 'removed' = 'active',
): Promise<void> {
  await tx`insert into memberships (tenant_id, user_id, status) values (${tenantId}, ${userId}, ${status})`;
}

export async function userInTenant(tx: Tx, tenantId: string): Promise<string> {
  const userId = await createTestUser(tx);
  await addMembership(tx, tenantId, userId);
  return userId;
}

export async function hookClaims(tx: Tx, userId: string): Promise<Record<string, unknown>> {
  const event = { user_id: userId, claims: { sub: userId, role: 'authenticated' } };
  const rows = await tx<{ out: { claims: Record<string, unknown> } }[]>`
    select public.custom_access_token_hook(${tx.json(event)}) as out`;
  return rows[0]!.out.claims;
}

/**
 * Generic isolation check: rows inserted (as superuser) for tenants A and B; a user of A
 * sees only A's row and cannot insert a row claiming tenant B.
 */
export async function expectTenantIsolation(
  tx: Tx,
  table: string,
  insertRow: (tenantId: string) => Promise<void>,
  insertAsUserForTenant: (tenantId: string) => Promise<unknown>,
): Promise<void> {
  const { asUser, expectDbError } = await import('../src/test-harness');
  const a = await createTenant(tx, 'Iso A');
  const b = await createTenant(tx, 'Iso B');
  await insertRow(a);
  await insertRow(b);
  const u = await userInTenant(tx, a);
  await asUser(tx, { sub: u, tenant_id: a }, async () => {
    const rows = await tx`select distinct tenant_id from ${tx(table)}`;
    if (rows.length !== 1 || rows[0]!.tenant_id !== a) {
      throw new Error(`${table}: expected only tenant A rows, got ${JSON.stringify(rows)}`);
    }
    await expectDbError(tx, /row-level security/, () => insertAsUserForTenant(b));
  });
}
