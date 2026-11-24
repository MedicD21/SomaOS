import { afterAll, describe, expect, it } from 'vitest';
import { asUser, closeTestDb, createTestUser, expectDbError, withAdmin } from '../src/test-harness';
import { addMembership, createTenant, hookClaims, userInTenant } from './helpers';

afterAll(closeTestDb);

describe('tenant isolation', () => {
  it('only shows the active tenant settings and blocks writes to another tenant', async () => {
    await withAdmin(async (tx) => {
      const a = await createTenant(tx, 'A');
      const b = await createTenant(tx, 'B');
      const u = await userInTenant(tx, a);
      await asUser(tx, { sub: u, tenant_id: a }, async () => {
        const rows = await tx`select tenant_id from tenant_settings`;
        expect(rows.map((r) => r.tenant_id)).toEqual([a]);
        await expect(
          tx`update tenant_settings set terminology = '{"shift":"x"}' where tenant_id = ${b} returning tenant_id`,
        ).resolves.toHaveLength(0);
        await expectDbError(tx, /row-level security/, () => tx`insert into tenant_settings (tenant_id) values (${b})`);
      });
    });
  });

  it('hides the previous tenant after switching', async () => {
    await withAdmin(async (tx) => {
      const a = await createTenant(tx, 'A');
      const b = await createTenant(tx, 'B');
      const u = await userInTenant(tx, a);
      await addMembership(tx, b, u);
      await asUser(tx, { sub: u, tenant_id: b }, async () => {
        const rows = await tx`select count(*)::int as n from tenant_settings where tenant_id = ${a}`;
        expect(rows[0]!.n).toBe(0);
      });
    });
  });
});

describe('custom access token hook', () => {
  it('sets tenant_id only while membership is active', async () => {
    await withAdmin(async (tx) => {
      const a = await createTenant(tx);
      const u = await userInTenant(tx, a);
      await tx`update profiles set active_tenant_id = ${a} where user_id = ${u}`;
      expect((await hookClaims(tx, u)).tenant_id).toBe(a);
      await tx`update memberships set status = 'suspended' where user_id = ${u}`;
      expect((await hookClaims(tx, u)).tenant_id).toBeNull();
    });
  });

  it('sets null tenant when the user has no active tenant', async () => {
    await withAdmin(async (tx) => {
      const u = await createTestUser(tx);
      expect((await hookClaims(tx, u)).tenant_id).toBeNull();
    });
  });
});

describe('app.set_active_tenant', () => {
  it('rejects a tenant the user is not a member of', async () => {
    await withAdmin(async (tx) => {
      const a = await createTenant(tx, 'A');
      const b = await createTenant(tx, 'B');
      const u = await userInTenant(tx, a);
      await asUser(tx, { sub: u, tenant_id: a }, async () => {
        await expectDbError(tx, /not a member/, () => tx`select app.set_active_tenant(${b})`);
      });
    });
  });

  it('updates the profile for a member tenant', async () => {
    await withAdmin(async (tx) => {
      const a = await createTenant(tx, 'A');
      const u = await userInTenant(tx, a);
      await asUser(tx, { sub: u, tenant_id: null }, async () => {
        await tx`select app.set_active_tenant(${a})`;
      });
      const rows = await tx`select active_tenant_id from profiles where user_id = ${u}`;
      expect(rows[0]!.active_tenant_id).toBe(a);
    });
  });
});

describe('app.create_tenant', () => {
  it('rejects an unknown timezone', async () => {
    await withAdmin(async (tx) => {
      await expectDbError(tx, /timezone/, () => createTenant(tx, 'X', 'Mars/Olympus'));
    });
  });

  it('is not callable by authenticated users', async () => {
    await withAdmin(async (tx) => {
      const u = await createTestUser(tx);
      await asUser(tx, { sub: u, tenant_id: null }, async () => {
        await expectDbError(tx, /permission denied/, () => createTenant(tx));
      });
    });
  });
});

describe('memberships visibility', () => {
  it('shows own memberships across tenants and all memberships of the active tenant', async () => {
    await withAdmin(async (tx) => {
      const a = await createTenant(tx, 'A');
      const b = await createTenant(tx, 'B');
      const u = await userInTenant(tx, a);
      await addMembership(tx, b, u);
      await userInTenant(tx, a); // colleague in A
      await userInTenant(tx, b); // stranger in B
      await asUser(tx, { sub: u, tenant_id: a }, async () => {
        const rows = await tx`select tenant_id, user_id from memberships`;
        expect(rows).toHaveLength(3); // own A, own B, colleague A
        expect(rows.filter((r) => r.tenant_id === b)).toHaveLength(1);
      });
    });
  });
});
