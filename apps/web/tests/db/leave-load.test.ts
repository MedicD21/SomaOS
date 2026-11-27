import { afterAll, describe, expect, it } from 'vitest';
import { asUser, closeTestDb, withAdmin, type Tx } from '@soma/db/src/test-harness';
import { createMember, createRole, createTenant, grantRole, userInTenant } from '@soma/db/tests/helpers';
import { loadMyLeave } from '@/server/leave/load';

afterAll(() => closeTestDb());

/** A member holding `perms` department-wide, linked to a fresh user. */
async function person(tx: Tx, t: string, perms: string[]) {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u });
  await grantRole(tx, t, m, await createRole(tx, t, `r_${m.slice(0, 6)}`, perms));
  return u;
}

describe('loadMyLeave', () => {
  it('offers officer-only leave types only to approvers and leave managers', async () => {
    await withAdmin(async (tx) => {
      const tenant = await createTenant(tx, 'Load FD');
      await tx`insert into leave_types (tenant_id, key, label, audience, sort) values
                 (${tenant}, 'sick', 'Sick', 'member', 1), (${tenant}, 'admin_leave', 'Admin leave', 'officer', 2)`;
      const crew = await person(tx, tenant, ['leave.request']);
      const officer = await person(tx, tenant, ['leave.request', 'leave.approve']);

      const labels = async (u: string) => {
        let out: string[] = [];
        await asUser(tx, { sub: u, tenant_id: tenant }, async () => {
          out = (await loadMyLeave(tx)).types.map((x) => x.label);
        });
        return out;
      };
      expect(await labels(crew)).toEqual(['Sick']);
      expect(await labels(officer)).toEqual(['Sick', 'Admin leave']);
    });
  });
});
