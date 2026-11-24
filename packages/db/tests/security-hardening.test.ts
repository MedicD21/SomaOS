import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, createTestUser, expectDbError, withAdmin } from '../src/test-harness';
import { createMember, createOrgUnit, createRole, createTenant, grantRole, userInTenant } from './helpers';

afterAll(closeTestDb);

async function userWith(tx: Tx, t: string, perms: string[], opts: { scopeKind?: 'department' | 'org_unit'; orgUnitId?: string } = {}) {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u });
  if (perms.length) await grantRole(tx, t, m, await createRole(tx, t, `r_${m.slice(0, 6)}`, perms), opts);
  return { u, m };
}

describe('F2: stale JWT after membership loss', () => {
  it('a suspended member with a still-valid tenant claim sees nothing', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const { u } = await userWith(tx, t, ['admin.members.view']);
      await tx`update memberships set status = 'suspended' where user_id = ${u}`;
      await asUser(tx, { sub: u, tenant_id: t }, async () => {
        expect((await tx`select app.tenant_id() as t`)[0]!.t).toBeNull();
        expect((await tx`select count(*)::int as n from members`)[0]!.n).toBe(0);
        expect((await tx`select count(*)::int as n from app.my_grants()`)[0]!.n).toBe(0);
      });
    });
  });

  it('a separated member holds no grants', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const { u, m } = await userWith(tx, t, ['admin.members.view']);
      await tx`update members set status = 'separated' where id = ${m}`;
      await asUser(tx, { sub: u, tenant_id: t }, async () => {
        expect((await tx`select count(*)::int as n from app.my_grants()`)[0]!.n).toBe(0);
      });
    });
  });
});

describe('F3: scope-aware DB permission checks and no privilege escalation', () => {
  it('an org-unit-scoped role manager cannot write grants in the database', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const st = await createOrgUnit(tx, t);
      const { u, m } = await userWith(tx, t, ['admin.roles.manage'], { scopeKind: 'org_unit', orgUnitId: st });
      const adminRole = await createRole(tx, t, 'boss', ['admin.roles.manage']);
      await asUser(tx, { sub: u, tenant_id: t }, async () => {
        await expectDbError(tx, /row-level security|cannot grant permissions/, () =>
          tx`insert into role_grants (tenant_id, member_id, role_id, scope_kind) values (${t}, ${m}, ${adminRole}, 'department')`);
        // RLS itself (not just the escalation trigger) blocks scoped managers: deletes match nothing.
        expect((await tx`delete from role_grants returning id`).length).toBe(0);
      });
    });
  });

  it('a role manager cannot hand out permissions they do not hold', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const { u, m } = await userWith(tx, t, ['admin.roles.manage']);
      const auditRole = await createRole(tx, t, 'auditor', ['admin.audit.view']);
      const mine = (await tx`select role_id from role_grants where member_id = ${m}`)[0]!.role_id as string;
      await asUser(tx, { sub: u, tenant_id: t }, async () => {
        await expectDbError(tx, /cannot grant permissions you do not hold/, () =>
          tx`insert into role_permissions (tenant_id, role_id, permission) values (${t}, ${mine}, 'admin.audit.view')`);
        await expectDbError(tx, /cannot grant permissions you do not hold/, () =>
          tx`insert into role_grants (tenant_id, member_id, role_id, scope_kind) values (${t}, ${m}, ${auditRole}, 'department')`);
      });
    });
  });

  it('a full department admin can still grant roles', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const { u } = await userWith(tx, t, ['admin.roles.manage', 'admin.audit.view']);
      const other = await createMember(tx, t);
      const auditRole = await createRole(tx, t, 'auditor', ['admin.audit.view']);
      await asUser(tx, { sub: u, tenant_id: t }, async () => {
        await tx`insert into role_grants (tenant_id, member_id, role_id, scope_kind) values (${t}, ${other}, ${auditRole}, 'department')`;
      });
    });
  });
});

describe('F4: approved config cannot be un-approved', () => {
  it('blocks approved → draft for everyone and non-admin updates of approved rows', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const plain = await userWith(tx, t, []);
      const cfg = await userWith(tx, t, ['admin.config.manage']);
      await tx`insert into config_versions (tenant_id, kind, key, version, status, effective, payload)
               values (${t}, 'pay', 'ot', 1, 'approved', '[2026-01-01,)', '{}')`;
      await asUser(tx, { sub: plain.u, tenant_id: t }, async () => {
        expect((await tx`update config_versions set status = 'draft' returning id`).length).toBe(0);
      });
      await asUser(tx, { sub: cfg.u, tenant_id: t }, async () => {
        await expectDbError(tx, /cannot return approved config to draft/, () => tx`update config_versions set status = 'draft'`);
        await tx`update config_versions set status = 'retired'`;
      });
    });
  });
});

describe('F1/F6: invitations require the invitee’s consent and verified email', () => {
  async function setupInvite(tx: Tx) {
    const t = await createTenant(tx);
    const admin = await userWith(tx, t, ['admin.members.manage']);
    const target = await createMember(tx, t);
    await tx`update members set email = 'captain@dept.test' where id = ${target}`;
    let inviteId = '';
    await asUser(tx, { sub: admin.u, tenant_id: t }, async () => {
      inviteId = (await tx`select app.enqueue_invite(${target}) as id`)[0]!.id as string;
    });
    return { t, target, inviteId };
  }

  it('enqueue_invite creates a pending invite and links nobody', async () => {
    await withAdmin(async (tx) => {
      const { target, inviteId } = await setupInvite(tx);
      const [inv] = await tx`select email, accepted_at from member_invites where id = ${inviteId}`;
      expect(inv).toMatchObject({ email: 'captain@dept.test', accepted_at: null });
      expect((await tx`select user_id from members where id = ${target}`)[0]!.user_id).toBeNull();
      const [job] = await tx`select payload from jobs where kind = 'invite-member' order by id desc limit 1`;
      expect(job!.payload.invite_id).toBe(inviteId);
    });
  });

  it('only the owner of the verified invited email can accept, and only that invite', async () => {
    await withAdmin(async (tx) => {
      const { t, target, inviteId } = await setupInvite(tx);
      const attacker = await createTestUser(tx, 'attacker@evil.test');
      await tx`update auth.users set email_confirmed_at = now() where id = ${attacker}`;
      await asUser(tx, { sub: attacker, tenant_id: null }, async () => {
        await expectDbError(tx, /invitation not found/, () => tx`select app.accept_invite(${inviteId})`);
      });
      const unverified = await createTestUser(tx, 'Captain@Dept.test');
      await asUser(tx, { sub: unverified, tenant_id: null }, async () => {
        await expectDbError(tx, /invitation not found/, () => tx`select app.accept_invite(${inviteId})`);
      });
      await tx`update auth.users set email_confirmed_at = now() where id = ${unverified}`;
      await asUser(tx, { sub: unverified, tenant_id: null }, async () => {
        expect((await tx`select app.accept_invite(${inviteId}) as t`)[0]!.t).toBe(t);
      });
      expect((await tx`select user_id from members where id = ${target}`)[0]!.user_id).toBe(unverified);
      expect((await tx`select status from memberships where user_id = ${unverified}`)[0]!.status).toBe('active');
    });
  });

  it('lists only the caller’s own pending invites', async () => {
    await withAdmin(async (tx) => {
      await setupInvite(tx);
      const owner = await createTestUser(tx, 'captain@dept.test');
      await tx`update auth.users set email_confirmed_at = now() where id = ${owner}`;
      const other = await createTestUser(tx);
      await tx`update auth.users set email_confirmed_at = now() where id = ${other}`;
      await asUser(tx, { sub: owner, tenant_id: null }, async () => {
        expect((await tx`select * from app.my_invites()`).length).toBe(1);
      });
      await asUser(tx, { sub: other, tenant_id: null }, async () => {
        expect((await tx`select * from app.my_invites()`).length).toBe(0);
      });
    });
  });
});
