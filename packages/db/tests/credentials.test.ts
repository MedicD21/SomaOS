import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import {
  addCredential,
  createCredentialType,
  createMember,
  createRole,
  createTenant,
  expectTenantIsolation,
  grantRole,
  userInTenant,
} from './helpers';

afterAll(closeTestDb);

async function actor(tx: Tx, t: string, perms: string[]) {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u });
  if (perms.length) await grantRole(tx, t, m, await createRole(tx, t, `c_${m.slice(0, 6)}`, perms));
  return { u, m };
}

describe('credential_types', () => {
  it('isolates tenants', async () => {
    await withAdmin(async (tx) => {
      await expectTenantIsolation(
        tx,
        'credential_types',
        async (t) => { await createCredentialType(tx, t, 'emt'); },
        (t) => tx`insert into credential_types (tenant_id, key, label, validity) values (${t}, 'x', 'x', '{}'::jsonb)`,
      );
    });
  });

  it('is writable only with scheduling.config.manage', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const plain = await actor(tx, t, []);
      const admin = await actor(tx, t, ['scheduling.config.manage']);
      await asUser(tx, { sub: plain.u, tenant_id: t }, async () => {
        await expectDbError(tx, /row-level security/, () =>
          tx`insert into credential_types (tenant_id, key, label, validity) values (${t}, 'a', 'a', '{}'::jsonb)`);
      });
      await asUser(tx, { sub: admin.u, tenant_id: t }, async () => {
        await tx`insert into credential_types (tenant_id, key, label, validity) values (${t}, 'a', 'a', '{}'::jsonb)`;
      });
    });
  });
});

describe('member_credentials', () => {
  it('isolates tenants (even for a credentials.view holder)', async () => {
    await withAdmin(async (tx) => {
      const a = await createTenant(tx, 'Iso A');
      const b = await createTenant(tx, 'Iso B');
      for (const t of [a, b]) {
        const m = await createMember(tx, t);
        await addCredential(tx, t, m, await createCredentialType(tx, t, 'emt'), '2027-01-01');
      }
      const v = await actor(tx, a, ['credentials.view', 'credentials.manage']);
      const bm = await createMember(tx, b);
      const bt = await createCredentialType(tx, b, 'k2');
      await asUser(tx, { sub: v.u, tenant_id: a }, async () => {
        const rows = await tx`select distinct tenant_id from member_credentials`;
        expect(rows.map((r) => r.tenant_id)).toEqual([a]);
        await expectDbError(tx, /row-level security/, () =>
          tx`insert into member_credentials (tenant_id, member_id, type_id, issued_on) values (${b}, ${bm}, ${bt}, '2025-01-01')`);
      });
    });
  });

  it('shows own credentials without credentials.view, all with it', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const ty = await createCredentialType(tx, t, 'emt');
      const me = await actor(tx, t, []);
      const hr = await actor(tx, t, ['credentials.view']);
      const other = await createMember(tx, t);
      await addCredential(tx, t, me.m, ty, '2027-01-01');
      await addCredential(tx, t, other, ty, '2027-01-01');
      await asUser(tx, { sub: me.u, tenant_id: t }, async () => {
        const rows = await tx`select member_id from member_credentials`;
        expect(rows.map((r) => r.member_id)).toEqual([me.m]);
      });
      await asUser(tx, { sub: hr.u, tenant_id: t }, async () => {
        expect(await tx`select 1 from member_credentials`).toHaveLength(2);
      });
    });
  });

  it('requires credentials.manage to write', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const ty = await createCredentialType(tx, t, 'emt');
      const viewer = await actor(tx, t, ['credentials.view']);
      const mgr = await actor(tx, t, ['credentials.manage']);
      const ins = (u: string) => tx`insert into member_credentials (tenant_id, member_id, type_id, issued_on)
        values (${t}, ${u}, ${ty}, '2025-01-01')`;
      await asUser(tx, { sub: viewer.u, tenant_id: t }, async () => {
        await expectDbError(tx, /row-level security/, () => ins(viewer.m));
      });
      await asUser(tx, { sub: mgr.u, tenant_id: t }, async () => {
        await ins(mgr.m);
      });
    });
  });
});

describe('app.member_qualifications', () => {
  it('returns active credentials for roster viewers only, current tenant only', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const t2 = await createTenant(tx, 'Other');
      const ty = await createCredentialType(tx, t, 'emt');
      const m = await createMember(tx, t);
      const revokedType = await createCredentialType(tx, t, 'cpr');
      await addCredential(tx, t, m, ty, '2027-01-01');
      const rev = await addCredential(tx, t, m, revokedType, '2027-01-01');
      await tx`update member_credentials set status = 'revoked' where id = ${rev}`;
      const m2 = await createMember(tx, t2);
      await addCredential(tx, t2, m2, await createCredentialType(tx, t2, 'emt'), '2027-01-01');
      const sched = await actor(tx, t, ['scheduling.roster.view']);
      const none = await actor(tx, t, []);
      await asUser(tx, { sub: sched.u, tenant_id: t }, async () => {
        const rows = await tx`select * from app.member_qualifications(${[m, m2]}::uuid[])`;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ member_id: m, type_id: ty, type_label: 'emt' });
      });
      await asUser(tx, { sub: none.u, tenant_id: t }, async () => {
        expect(await tx`select * from app.member_qualifications(${[m]}::uuid[])`).toHaveLength(0);
      });
    });
  });
});
