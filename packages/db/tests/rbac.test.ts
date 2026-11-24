import { afterAll, describe, expect, it } from 'vitest';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import {
  createMember,
  createOrgUnit,
  createRole,
  createTenant,
  expectTenantIsolation,
  grantRole,
  userInTenant,
} from './helpers';

afterAll(closeTestDb);

describe('app.my_grants', () => {
  it('returns only the caller’s current grants with scope paths', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const u = await userInTenant(tx, t);
      const me = await createMember(tx, t, { userId: u });
      const other = await createMember(tx, t);
      const st = await createOrgUnit(tx, t, 'S1');
      const role = await createRole(tx, t, 'captain', ['admin.members.view']);
      await grantRole(tx, t, me, role, { scopeKind: 'org_unit', orgUnitId: st });
      await grantRole(tx, t, me, role, { valid: '[2025-01-01,2025-06-01)' }); // expired
      await grantRole(tx, t, other, role);
      const stPath = (await tx`select path::text as p from org_units where id = ${st}`)[0]!.p;
      await asUser(tx, { sub: u, tenant_id: t }, async () => {
        const rows = await tx`select * from app.my_grants()`;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          permission: 'admin.members.view',
          scope_kind: 'org_unit',
          scope_path: stPath,
          role_key: 'captain',
          valid_to: null,
        });
      });
    });
  });
});

describe('last admin protection', () => {
  async function setup(tx: Parameters<Parameters<typeof withAdmin>[0]>[0]) {
    const t = await createTenant(tx);
    const m = await createMember(tx, t);
    const role = await createRole(tx, t, 'dept_admin', ['admin.roles.manage']);
    const g = await grantRole(tx, t, m, role);
    return { t, m, role, g };
  }

  it('blocks deleting the only department-scoped admin grant', async () => {
    await withAdmin(async (tx) => {
      const { g } = await setup(tx);
      await expectDbError(tx, /cannot remove last admin/, () => tx`delete from role_grants where id = ${g}`);
    });
  });

  it('blocks ending the only admin grant or removing the permission from the role', async () => {
    await withAdmin(async (tx) => {
      const { g, role } = await setup(tx);
      await expectDbError(tx, /cannot remove last admin/, () =>
        tx`update role_grants set valid = tstzrange(lower(valid), now()) where id = ${g}`,
      );
      await expectDbError(tx, /cannot remove last admin/, () =>
        tx`delete from role_permissions where role_id = ${role} and permission = 'admin.roles.manage'`,
      );
    });
  });

  it('allows removing an admin grant when another admin remains', async () => {
    await withAdmin(async (tx) => {
      const { t, role, g } = await setup(tx);
      const m2 = await createMember(tx, t);
      await grantRole(tx, t, m2, role);
      await tx`delete from role_grants where id = ${g}`;
    });
  });

  it('does not block deleting a whole tenant', async () => {
    await withAdmin(async (tx) => {
      const { t } = await setup(tx);
      await tx`delete from tenants where id = ${t}`;
    });
  });
});

describe('role_grants scope checks', () => {
  it('requires an org unit exactly when scope_kind is org_unit', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const m = await createMember(tx, t);
      const role = await createRole(tx, t, 'r', []);
      await expectDbError(tx, /role_grants_scope_check/, () => grantRole(tx, t, m, role, { scopeKind: 'org_unit' }));
    });
  });
});

describe('rbac tenant isolation', () => {
  it('isolates roles, role_permissions, role_grants', async () => {
    await withAdmin(async (tx) => {
      await expectTenantIsolation(
        tx,
        'roles',
        async (t) => void (await createRole(tx, t, 'r', [])),
        (t) => tx`insert into roles (tenant_id, key, label) values (${t}, 'x', 'x')`,
      );
      await expectTenantIsolation(
        tx,
        'role_permissions',
        async (t) => void (await createRole(tx, t, 'r2', ['files.view'])),
        (t) => tx`insert into role_permissions (tenant_id, role_id, permission) values (${t}, gen_random_uuid(), 'x')`,
      );
      await expectTenantIsolation(
        tx,
        'role_grants',
        async (t) => {
          const m = await createMember(tx, t);
          await grantRole(tx, t, m, await createRole(tx, t, 'r3', []));
        },
        (t) => tx`insert into role_grants (tenant_id, member_id, role_id, scope_kind) values (${t}, gen_random_uuid(), gen_random_uuid(), 'department')`,
      );
    });
  });
});
