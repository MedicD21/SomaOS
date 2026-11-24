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

export async function createMember(
  tx: Tx,
  tenantId: string,
  opts: { userId?: string | null; first?: string; last?: string; employeeNumber?: string } = {},
): Promise<string> {
  const rows = await tx<{ id: string }[]>`
    insert into members (tenant_id, user_id, first_name, last_name, employee_number, employment_type)
    values (${tenantId}, ${opts.userId ?? null}, ${opts.first ?? 'Pat'}, ${opts.last ?? 'Medic'},
            ${opts.employeeNumber ?? crypto.randomUUID().slice(0, 8)}, 'career_full_time')
    returning id`;
  return rows[0]!.id;
}

export async function createOrgUnit(tx: Tx, tenantId: string, name = 'Station 1', parentId: string | null = null): Promise<string> {
  const t = await tx<{ id: string }[]>`
    insert into org_unit_types (tenant_id, key, label) values (${tenantId}, 'station', 'Station')
    on conflict (tenant_id, key) do update set label = excluded.label returning id`;
  const r = await tx<{ id: string }[]>`
    insert into org_units (tenant_id, type_id, parent_id, name) values (${tenantId}, ${t[0]!.id}, ${parentId}, ${name}) returning id`;
  return r[0]!.id;
}

export async function createRole(tx: Tx, tenantId: string, key: string, permissions: string[]): Promise<string> {
  const r = await tx<{ id: string }[]>`
    insert into roles (tenant_id, key, label) values (${tenantId}, ${key}, ${key}) returning id`;
  const roleId = r[0]!.id;
  for (const p of permissions) {
    await tx`insert into role_permissions (tenant_id, role_id, permission) values (${tenantId}, ${roleId}, ${p})`;
  }
  return roleId;
}

export async function grantRole(
  tx: Tx,
  tenantId: string,
  memberId: string,
  roleId: string,
  opts: { scopeKind?: 'self' | 'org_unit' | 'department'; orgUnitId?: string | null; shiftId?: string | null; valid?: string } = {},
): Promise<string> {
  const r = await tx<{ id: string }[]>`
    insert into role_grants (tenant_id, member_id, role_id, scope_kind, scope_org_unit_id, scope_shift_id, valid)
    values (${tenantId}, ${memberId}, ${roleId}, ${opts.scopeKind ?? 'department'}, ${opts.orgUnitId ?? null},
            ${opts.shiftId ?? null}, ${opts.valid ?? '[2026-01-01,)'}::tstzrange)
    returning id`;
  return r[0]!.id;
}

export async function createCredentialType(
  tx: Tx,
  tenantId: string,
  key: string,
  validity: Record<string, unknown> = { kind: 'fixed', months: 24 },
): Promise<string> {
  const r = await tx<{ id: string }[]>`
    insert into credential_types (tenant_id, key, label, validity)
    values (${tenantId}, ${key}, ${key}, ${tx.json(validity as never)}) returning id`;
  return r[0]!.id;
}

export async function addCredential(
  tx: Tx,
  tenantId: string,
  memberId: string,
  typeId: string,
  expiresOn: string | null,
): Promise<string> {
  const r = await tx<{ id: string }[]>`
    insert into member_credentials (tenant_id, member_id, type_id, issued_on, expires_on)
    values (${tenantId}, ${memberId}, ${typeId}, '2025-01-01', ${expiresOn}) returning id`;
  return r[0]!.id;
}

export async function createSeat(tx: Tx, tenantId: string, orgUnitId: string, label = 'Engine 1 Officer'): Promise<string> {
  const r = await tx<{ id: string }[]>`
    insert into seats (tenant_id, org_unit_id, label) values (${tenantId}, ${orgUnitId}, ${label}) returning id`;
  return r[0]!.id;
}
