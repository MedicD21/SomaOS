import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { createMember, createOrgUnit, createRole, createTenant, expectTenantIsolation, grantRole, userInTenant } from './helpers';

afterAll(closeTestDb);

async function person(tx: Tx, t: string, opts: { perms?: string[]; scope?: Parameters<typeof grantRole>[4] } = {}) {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u });
  if (opts.perms?.length) await grantRole(tx, t, m, await createRole(tx, t, `r_${m.slice(0, 6)}`, opts.perms), opts.scope);
  return { u, m };
}

const addRate = (tx: Tx, t: string, member: string, rate: number, range: string) =>
  tx`insert into member_pay_rates (tenant_id, member_id, hourly_rate, effective) values (${t}, ${member}, ${rate}, ${range}::daterange)`;

describe('pay codes and employee groups', () => {
  it('are tenant isolated', async () => {
    await withAdmin(async (tx) => {
      await expectTenantIsolation(tx, 'pay_codes', async (t) => void (await tx`insert into pay_codes (tenant_id, key, label, kind) values (${t}, 'reg', 'Regular', 'regular')`),
        (t) => tx`insert into pay_codes (tenant_id, key, label, kind) values (${t}, 'x', 'X', 'other')`);
      await expectTenantIsolation(tx, 'employee_groups', async (t) => void (await tx`insert into employee_groups (tenant_id, key, label) values (${t}, 'line', 'Line')`),
        (t) => tx`insert into employee_groups (tenant_id, key, label) values (${t}, 'x', 'X')`);
    });
  });

  it('anyone in the department reads them, only department-wide pay.manage writes', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const unit = await createOrgUnit(tx, t);
      const plain = await person(tx, t);
      const scoped = await person(tx, t, { perms: ['pay.manage'], scope: { scopeKind: 'org_unit', orgUnitId: unit } });
      const mgr = await person(tx, t, { perms: ['pay.manage'] });
      await tx`insert into pay_codes (tenant_id, key, label, kind) values (${t}, 'reg', 'Regular', 'regular')`;
      await asUser(tx, { sub: plain.u, tenant_id: t }, async () => {
        expect((await tx`select 1 from pay_codes`).length).toBe(1);
        await expectDbError(tx, /row-level security/, () => tx`insert into pay_codes (tenant_id, key, label, kind) values (${t}, 'ot', 'OT', 'overtime')`);
      });
      await asUser(tx, { sub: scoped.u, tenant_id: t }, async () => {
        await expectDbError(tx, /row-level security/, () => tx`insert into employee_groups (tenant_id, key, label) values (${t}, 'g', 'G')`);
      });
      await asUser(tx, { sub: mgr.u, tenant_id: t }, async () => {
        await tx`insert into pay_codes (tenant_id, key, label, kind, multiplier) values (${t}, 'ot', 'OT', 'overtime', 1.5)`;
        await tx`insert into employee_groups (tenant_id, key, label) values (${t}, 'g', 'G')`;
      });
    });
  });

  it('validates keys, kinds and multipliers', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      await expectDbError(tx, /pay_codes_key_check/, () => tx`insert into pay_codes (tenant_id, key, label, kind) values (${t}, 'Bad Key', 'x', 'regular')`);
      await expectDbError(tx, /pay_codes_kind_check/, () => tx`insert into pay_codes (tenant_id, key, label, kind) values (${t}, 'k', 'x', 'bonus')`);
      await expectDbError(tx, /pay_codes_multiplier_check/, () => tx`insert into pay_codes (tenant_id, key, label, kind, multiplier) values (${t}, 'k', 'x', 'overtime', 9)`);
    });
  });

  it('a member cannot be put in another department’s group', async () => {
    await withAdmin(async (tx) => {
      const a = await createTenant(tx, 'A');
      const b = await createTenant(tx, 'B');
      const m = await createMember(tx, a);
      const [g] = await tx<{ id: string }[]>`insert into employee_groups (tenant_id, key, label) values (${b}, 'g', 'G') returning id`;
      await expectDbError(tx, /violates foreign key/, () => tx`update members set employee_group_id = ${g!.id} where id = ${m}`);
    });
  });
});

describe('member pay rates are sensitive', () => {
  it('only department-wide pay.view or pay.manage holders can read them', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const unit = await createOrgUnit(tx, t);
      const subject = await person(tx, t);
      const self = await person(tx, t);
      const officer = await person(tx, t, { perms: ['admin.members.view'] });
      const scoped = await person(tx, t, { perms: ['pay.view'], scope: { scopeKind: 'org_unit', orgUnitId: unit } });
      const viewer = await person(tx, t, { perms: ['pay.view'] });
      const mgr = await person(tx, t, { perms: ['pay.manage'] });
      await addRate(tx, t, subject.m, 31.5, '[2026-01-01,)');
      await addRate(tx, t, self.m, 28, '[2026-01-01,)');
      const visible = async (who: { u: string }) => {
        let n = 0;
        await asUser(tx, { sub: who.u, tenant_id: t }, async () => { n = (await tx`select 1 from member_pay_rates`).length; });
        return n;
      };
      expect(await visible(self)).toBe(0);      // not even their own rate
      expect(await visible(officer)).toBe(0);
      expect(await visible(scoped)).toBe(0);
      expect(await visible(viewer)).toBe(2);
      expect(await visible(mgr)).toBe(2);
    });
  });

  it('is isolated between departments', async () => {
    await withAdmin(async (tx) => {
      const a = await createTenant(tx, 'A');
      const b = await createTenant(tx, 'B');
      const viewer = await person(tx, a, { perms: ['pay.view'] });
      await addRate(tx, a, await createMember(tx, a), 20, '[2026-01-01,)');
      await addRate(tx, b, await createMember(tx, b), 99, '[2026-01-01,)');
      await asUser(tx, { sub: viewer.u, tenant_id: a }, async () => {
        const rows = await tx`select tenant_id, hourly_rate::float8 as r from member_pay_rates`;
        expect(rows.map((r) => r.tenant_id)).toEqual([a]);
      });
    });
  });

  it('writes need department-wide pay.manage and nothing can be deleted', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const unit = await createOrgUnit(tx, t);
      const subject = await createMember(tx, t);
      const viewer = await person(tx, t, { perms: ['pay.view'] });
      const scoped = await person(tx, t, { perms: ['pay.manage'], scope: { scopeKind: 'org_unit', orgUnitId: unit } });
      const mgr = await person(tx, t, { perms: ['pay.manage'] });
      await asUser(tx, { sub: viewer.u, tenant_id: t }, async () => {
        await expectDbError(tx, /row-level security/, () => addRate(tx, t, subject, 30, '[2026-01-01,)'));
      });
      await asUser(tx, { sub: scoped.u, tenant_id: t }, async () => {
        await expectDbError(tx, /row-level security/, () => addRate(tx, t, subject, 30, '[2026-01-01,)'));
      });
      await asUser(tx, { sub: mgr.u, tenant_id: t }, async () => {
        await addRate(tx, t, subject, 30, '[2026-01-01,)');
        await expectDbError(tx, /permission denied/, () => tx`delete from member_pay_rates`);
      });
    });
  });

  it('rejects overlapping ranges, allows back-to-back, and refuses non-positive rates', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const m = await createMember(tx, t);
      await addRate(tx, t, m, 30, '[2026-01-01,2026-07-01)');
      await expectDbError(tx, /member_pay_rates_member_no_overlap/, () => addRate(tx, t, m, 31, '[2026-06-01,)'));
      await addRate(tx, t, m, 32, '[2026-07-01,)');
      await expectDbError(tx, /hourly_rate_check/, () => addRate(tx, t, m, 0, '[2030-01-01,)'));
    });
  });
});

describe('app.pay_rate_on', () => {
  it('returns the rate in force on a date, null outside, and refuses non-holders', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const subject = await createMember(tx, t);
      const viewer = await person(tx, t, { perms: ['pay.view'] });
      const plain = await person(tx, t);
      await addRate(tx, t, subject, 30, '[2026-01-01,2026-07-01)');
      await addRate(tx, t, subject, 32.5, '[2026-07-01,)');
      await asUser(tx, { sub: viewer.u, tenant_id: t }, async () => {
        const rate = async (d: string) => (await tx`select app.pay_rate_on(${subject}, ${d}::date)::float8 as r`)[0]!.r;
        expect(await rate('2026-03-01')).toBe(30);
        expect(await rate('2026-07-01')).toBe(32.5);
        expect(await rate('2025-12-31')).toBeNull();
      });
      await asUser(tx, { sub: plain.u, tenant_id: t }, async () => {
        await expectDbError(tx, /pay.view required/, () => tx`select app.pay_rate_on(${subject}, '2026-03-01'::date)`);
      });
    });
  });
});
