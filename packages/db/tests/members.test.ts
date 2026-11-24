import { afterAll, describe, expect, it } from 'vitest';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { createMember, createOrgUnit, createTenant, expectTenantIsolation, userInTenant } from './helpers';

afterAll(closeTestDb);

describe('member assignments', () => {
  it('rejects overlapping primary assignments for one member', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const m = await createMember(tx, t);
      const s1 = await createOrgUnit(tx, t, 'S1');
      const s2 = await createOrgUnit(tx, t, 'S2');
      await tx`insert into member_assignments (tenant_id, member_id, org_unit_id, effective)
               values (${t}, ${m}, ${s1}, '[2026-01-01,2026-12-31)')`;
      await expectDbError(tx, /member_assignments_no_overlap/, () =>
        tx`insert into member_assignments (tenant_id, member_id, org_unit_id, effective)
           values (${t}, ${m}, ${s2}, '[2026-06-01,)')`,
      );
    });
  });

  it('allows back-to-back primary and overlapping secondary assignments', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const m = await createMember(tx, t);
      const s1 = await createOrgUnit(tx, t, 'S1');
      const s2 = await createOrgUnit(tx, t, 'S2');
      await tx`insert into member_assignments (tenant_id, member_id, org_unit_id, effective)
               values (${t}, ${m}, ${s1}, '[2026-01-01,2026-07-01)'),
                      (${t}, ${m}, ${s2}, '[2026-07-01,)')`;
      await tx`insert into member_assignments (tenant_id, member_id, org_unit_id, is_primary, effective)
               values (${t}, ${m}, ${s1}, false, '[2026-03-01,)')`;
      const n = await tx`select count(*)::int as n from member_assignments where member_id = ${m}`;
      expect(n[0]!.n).toBe(3);
    });
  });

  it('rejects a member and org unit from different tenants', async () => {
    await withAdmin(async (tx) => {
      const a = await createTenant(tx, 'A');
      const b = await createTenant(tx, 'B');
      const m = await createMember(tx, a);
      const sb = await createOrgUnit(tx, b, 'SB');
      await expectDbError(tx, /violates foreign key/, () =>
        tx`insert into member_assignments (tenant_id, member_id, org_unit_id, effective)
           values (${a}, ${m}, ${sb}, '[2026-01-01,)')`,
      );
    });
  });
});

describe('app.my_member_id', () => {
  it('returns the member linked to the caller in the active tenant', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const u = await userInTenant(tx, t);
      const m = await createMember(tx, t, { userId: u });
      const other = await userInTenant(tx, t);
      await asUser(tx, { sub: u, tenant_id: t }, async () => {
        expect((await tx`select app.my_member_id() as id`)[0]!.id).toBe(m);
      });
      await asUser(tx, { sub: other, tenant_id: t }, async () => {
        expect((await tx`select app.my_member_id() as id`)[0]!.id).toBeNull();
      });
    });
  });
});

describe('members tenant isolation', () => {
  it('isolates members and member_assignments', async () => {
    await withAdmin(async (tx) => {
      await expectTenantIsolation(
        tx,
        'members',
        async (t) => void (await createMember(tx, t)),
        (t) => tx`insert into members (tenant_id, first_name, last_name, employment_type) values (${t}, 'x', 'y', 'volunteer')`,
      );
      await expectTenantIsolation(
        tx,
        'member_assignments',
        async (t) => {
          const m = await createMember(tx, t);
          const s = await createOrgUnit(tx, t);
          await tx`insert into member_assignments (tenant_id, member_id, org_unit_id, effective) values (${t}, ${m}, ${s}, '[2026-01-01,)')`;
        },
        (t) => tx`insert into member_assignments (tenant_id, member_id, org_unit_id, effective)
                  values (${t}, gen_random_uuid(), gen_random_uuid(), '[2026-01-01,)')`,
      );
    });
  });
});
