import { afterAll, describe, expect, it } from 'vitest';
import { can, toGrants } from '@soma/auth';
import type { MyGrantRow } from '@soma/auth';
import { TEMPLATES, applyTemplate } from '@soma/templates';
import { asUser, closeTestDb, createTestUser, withAdmin } from '../src/test-harness';
import { createTenant } from './helpers';

afterAll(closeTestDb);

describe('applyTemplate', () => {
  it('is idempotent and makes the first admin a department admin', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const u = await createTestUser(tx);
      const admin = { userId: u, firstName: 'Dana', lastName: 'Chief' };
      await applyTemplate(tx, t, TEMPLATES['career-3-platoon'], admin);
      await applyTemplate(tx, t, TEMPLATES['career-3-platoon'], admin);

      const counts = await tx`
        select (select count(*)::int from shifts where tenant_id = ${t}) as shifts,
               (select count(*)::int from ranks where tenant_id = ${t}) as ranks,
               (select count(*)::int from members where tenant_id = ${t}) as members,
               (select count(*)::int from role_grants where tenant_id = ${t}) as grants`;
      expect(counts[0]).toEqual({ shifts: 3, ranks: 9, members: 1, grants: 1 });

      await asUser(tx, { sub: u, tenant_id: t }, async () => {
        const rows = await tx<MyGrantRow[]>`select * from app.my_grants()`;
        const me = (await tx`select app.my_member_id() as id`)[0]!.id as string;
        expect(can(toGrants(rows), me, 'admin.roles.manage', {}, new Date()).allowed).toBe(true);
      });
    });
  });

  it('volunteer template has no shifts', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const u = await createTestUser(tx);
      await applyTemplate(tx, t, TEMPLATES.volunteer, { userId: u, firstName: 'V', lastName: 'Chief' });
      const n = await tx`select count(*)::int as n from shifts where tenant_id = ${t}`;
      expect(n[0]!.n).toBe(0);
    });
  });
});
