import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { createMember, createRole, createTenant, grantRole, userInTenant } from './helpers';

afterAll(closeTestDb);

async function memberUser(tx: Tx, tenantId: string, permissions: string[]) {
  const u = await userInTenant(tx, tenantId);
  const m = await createMember(tx, tenantId, { userId: u });
  if (permissions.length) await grantRole(tx, tenantId, m, await createRole(tx, tenantId, `r-${m.slice(0, 6)}`, permissions));
  return { u, m };
}

describe('audit log', () => {
  it('records updates with actor, changed fields, before/after and reason', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const { u } = await memberUser(tx, t, []);
      const target = await createMember(tx, t);
      await asUser(tx, { sub: u, tenant_id: t }, async () => {
        await tx`select set_config('app.reason', 'name correction', true)`;
        await tx`update members set last_name = 'New' where id = ${target}`;
      });
      const rows = await tx`
        select * from audit_log where table_name = 'members' and record_id = ${target} and action = 'update'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        tenant_id: t,
        actor_user_id: u,
        changed_fields: ['last_name'],
        reason: 'name correction',
      });
      expect(rows[0]!.before.last_name).toBe('Medic');
      expect(rows[0]!.after.last_name).toBe('New');
    });
  });

  it('records inserts and deletes on foundation tables', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const m = await createMember(tx, t);
      await tx`delete from members where id = ${m}`;
      const actions = await tx`select action from audit_log where record_id = ${m} order by id`;
      expect(actions.map((r) => r.action)).toEqual(['insert', 'delete']);
    });
  });

  it('cannot be modified, even by service_role', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      await createMember(tx, t);
      await tx`set local role service_role`;
      await expectDbError(tx, /permission denied/, () => tx`update audit_log set reason = 'x'`);
      await expectDbError(tx, /permission denied/, () => tx`delete from audit_log`);
      await tx`reset role`;
    });
  });

  it('is visible only to own-tenant holders of admin.audit.view', async () => {
    await withAdmin(async (tx) => {
      const a = await createTenant(tx, 'A');
      const b = await createTenant(tx, 'B');
      await createMember(tx, b);
      const plain = await memberUser(tx, a, []);
      const auditor = await memberUser(tx, a, ['admin.audit.view']);
      await asUser(tx, { sub: plain.u, tenant_id: a }, async () => {
        expect((await tx`select count(*)::int as n from audit_log`)[0]!.n).toBe(0);
      });
      await asUser(tx, { sub: auditor.u, tenant_id: a }, async () => {
        const rows = await tx`select distinct tenant_id from audit_log`;
        expect(rows.map((r) => r.tenant_id)).toEqual([a]);
      });
    });
  });
});
