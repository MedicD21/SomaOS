import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { createMember, createRole, createTenant, grantRole, userInTenant } from './helpers';

afterAll(closeTestDb);

async function userWith(tx: Tx, t: string, perms: string[]): Promise<string> {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u });
  if (perms.length) await grantRole(tx, t, m, await createRole(tx, t, `r_${m.slice(0, 6)}`, perms));
  return u;
}

const updated = async (q: PromiseLike<readonly unknown[]>) => (await q).length;

describe('admin write policies', () => {
  it('blocks settings and org writes for members without admin permissions', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const u = await userWith(tx, t, []);
      await asUser(tx, { sub: u, tenant_id: t }, async () => {
        expect(await updated(tx`update tenant_settings set terminology = '{"shift":"x"}' returning 1`)).toBe(0);
        expect(await updated(tx`update tenants set timezone = 'UTC' returning 1`)).toBe(0);
        await expectDbError(tx, /row-level security/, () =>
          tx`insert into ranks (tenant_id, key, label, sort) values (${t}, 'x', 'X', 1)`,
        );
        await expectDbError(tx, /row-level security/, () =>
          tx`insert into shifts (tenant_id, key, label) values (${t}, 'x', 'X')`,
        );
        await expectDbError(tx, /row-level security/, () =>
          tx`insert into org_unit_types (tenant_id, key, label) values (${t}, 'x', 'X')`,
        );
      });
    });
  });

  it('allows tenant admins to update settings and timezone', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const u = await userWith(tx, t, ['admin.tenant.manage']);
      await asUser(tx, { sub: u, tenant_id: t }, async () => {
        expect(await updated(tx`update tenant_settings set terminology = '{"shift":"Platoon"}' returning 1`)).toBe(1);
        expect(await updated(tx`update tenants set timezone = 'America/Denver' returning 1`)).toBe(1);
      });
    });
  });

  it('allows org admins to manage ranks, shifts and org units', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const u = await userWith(tx, t, ['admin.org.manage']);
      await asUser(tx, { sub: u, tenant_id: t }, async () => {
        await tx`insert into ranks (tenant_id, key, label, sort) values (${t}, 'capt', 'Captain', 4)`;
        await tx`insert into shifts (tenant_id, key, label) values (${t}, 'a', 'A')`;
        const [ty] = await tx`insert into org_unit_types (tenant_id, key, label) values (${t}, 'station', 'Station') returning id`;
        await tx`insert into org_units (tenant_id, type_id, name) values (${t}, ${ty!.id}, 'S1')`;
      });
    });
  });

  it('prevents tenant admins from changing identity columns of their tenant', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const u = await userWith(tx, t, ['admin.tenant.manage']);
      await asUser(tx, { sub: u, tenant_id: t }, async () => {
        await expectDbError(tx, /permission denied/, () => tx`update tenants set slug = 'hijack'`);
      });
    });
  });
});
