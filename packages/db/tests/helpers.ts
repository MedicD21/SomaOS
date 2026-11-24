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
