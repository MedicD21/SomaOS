import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { createMember, createRole, createTenant, grantRole, userInTenant } from './helpers';

afterAll(closeTestDb);

async function memberUser(tx: Tx, t: string, perms: string[], email: string | null = null) {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u });
  if (email) await tx`update members set email = ${email} where id = ${m}`;
  if (perms.length) await grantRole(tx, t, m, await createRole(tx, t, `r_${m.slice(0, 6)}`, perms));
  return { u, m };
}

describe('notifications', () => {
  it('members see only their own notifications and may only mark them read', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const a = await memberUser(tx, t, []);
      const b = await memberUser(tx, t, []);
      await tx`select app.notify(${a.m}, 'test', 'For A', 'body', null)`;
      await tx`select app.notify(${b.m}, 'test', 'For B', 'body', null)`;
      await asUser(tx, { sub: a.u, tenant_id: t }, async () => {
        const rows = await tx`select title from notifications`;
        expect(rows.map((r) => r.title)).toEqual(['For A']);
        expect((await tx`update notifications set read_at = now() returning id`).length).toBe(1);
        await expectDbError(tx, /permission denied/, () => tx`update notifications set title = 'x'`);
      });
    });
  });

  it('requires notifications.send to notify others', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const a = await memberUser(tx, t, []);
      const sender = await memberUser(tx, t, ['notifications.send']);
      await asUser(tx, { sub: a.u, tenant_id: t }, async () => {
        await expectDbError(tx, /not allowed/, () => tx`select app.notify(${sender.m}, 'x', 'y', 'z', null)`);
      });
      await asUser(tx, { sub: sender.u, tenant_id: t }, async () => {
        await tx`select app.notify(${a.m}, 'x', 'Hello', 'z', null)`;
      });
    });
  });

  it('cannot notify a member of another tenant', async () => {
    await withAdmin(async (tx) => {
      const t1 = await createTenant(tx, 'A');
      const t2 = await createTenant(tx, 'B');
      const sender = await memberUser(tx, t1, ['notifications.send']);
      const other = await createMember(tx, t2);
      await asUser(tx, { sub: sender.u, tenant_id: t1 }, async () => {
        await expectDbError(tx, /unknown member/, () => tx`select app.notify(${other}, 'x', 'y', 'z', null)`);
      });
    });
  });

  it('queues an email job when the member has an email and email is enabled', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const a = await memberUser(tx, t, [], 'pat@example.test');
      const quiet = await memberUser(tx, t, [], 'quiet@example.test');
      await tx`insert into notification_prefs (tenant_id, member_id, kind, channels) values (${t}, ${quiet.m}, 'test', '{in_app}')`;
      await tx`select app.notify(${a.m}, 'test', 'Subject', 'Body', '/x')`;
      await tx`select app.notify(${quiet.m}, 'test', 'Subject', 'Body', null)`;
      const jobs = await tx`select kind, payload from jobs where tenant_id = ${t}`;
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ kind: 'send-email', payload: { to: 'pat@example.test', subject: 'Subject' } });
    });
  });

  it('jobs are not readable by tenants', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const a = await memberUser(tx, t, ['admin.members.manage']);
      await asUser(tx, { sub: a.u, tenant_id: t }, async () => {
        await expectDbError(tx, /permission denied/, () => tx`select * from jobs`);
      });
    });
  });
});

describe('invites', () => {
  it('queues an invite for a member with an email and requires admin.members.manage', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const admin = await memberUser(tx, t, ['admin.members.manage']);
      const plain = await memberUser(tx, t, []);
      const target = await createMember(tx, t);
      await tx`update members set email = 'new@example.test' where id = ${target}`;
      await asUser(tx, { sub: plain.u, tenant_id: t }, async () => {
        await expectDbError(tx, /not allowed/, () => tx`select app.enqueue_invite(${target})`);
      });
      await asUser(tx, { sub: admin.u, tenant_id: t }, async () => {
        await tx`select app.enqueue_invite(${target})`;
      });
      const [job] = await tx`select kind, payload from jobs where tenant_id = ${t}`;
      expect(job).toMatchObject({ kind: 'invite-member', payload: { member_id: target, email: 'new@example.test', tenant_id: t } });
    });
  });

  it('accept_invites activates invited memberships for the caller', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const u = await userInTenant(tx, t);
      await tx`update memberships set status = 'invited' where user_id = ${u}`;
      await asUser(tx, { sub: u, tenant_id: null }, async () => {
        expect((await tx`select app.accept_invites() as n`)[0]!.n).toBe(1);
      });
      const [p] = await tx`select active_tenant_id from profiles where user_id = ${u}`;
      expect(p!.active_tenant_id).toBe(t);
    });
  });
});
