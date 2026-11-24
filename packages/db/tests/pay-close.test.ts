import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { createBank, createMember, createOrgUnit, createRole, createTenant, grantRole, userInTenant } from './helpers';

afterAll(closeTestDb);

async function person(tx: Tx, t: string, opts: { perms?: string[]; scope?: Parameters<typeof grantRole>[4] } = {}) {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u });
  if (opts.perms?.length) await grantRole(tx, t, m, await createRole(tx, t, `r_${m.slice(0, 6)}`, opts.perms), opts.scope);
  return { u, m };
}

const SNAP = { rows: [] };

// Read as the superuser (payroll cannot read other members' ledgers), then go back to the caller's role.
const balance = async (tx: Tx, member: string, bank: string) => {
  const r = (await tx<{ r: string }[]>`select current_user as r`)[0]!.r;
  await tx`reset role`;
  const rows = await tx<{ h: string | null }[]>`select sum(hours) as h from leave_ledger where member_id = ${member} and bank_id = ${bank}`;
  if (r !== 'postgres') await tx`select set_config('role', ${r}, true)`;
  return Number(rows[0]!.h ?? 0);
};

async function world(tx: Tx) {
  const t = await createTenant(tx);
  const bank = await createBank(tx, t, 'comp_time');
  const payroll = await person(tx, t, { perms: ['pay.manage'] });
  const subject = await person(tx, t);
  return { t, bank, payroll, subject };
}

const comp = (tx: Tx, member: string, hours: number, bank = 'comp_time') => tx.json([{ member_id: member, bank_key: bank, hours }]);

describe('closing a pay period', () => {
  it('only department-wide pay.manage can close or reopen', async () => {
    await withAdmin(async (tx) => {
      const { t, payroll, subject } = await world(tx);
      const unit = await createOrgUnit(tx, t);
      const scoped = await person(tx, t, { perms: ['pay.manage'], scope: { scopeKind: 'org_unit', orgUnitId: unit } });
      const viewer = await person(tx, t, { perms: ['pay.view'] });
      for (const who of [scoped, viewer, subject]) {
        await asUser(tx, { sub: who.u, tenant_id: t }, async () => {
          await expectDbError(tx, /pay\.manage required/, () => tx`select app.close_pay_period('2026-01-01', '2026-01-29', ${tx.json(SNAP)}, '[]'::jsonb)`);
        });
      }
      let closeId = '';
      await asUser(tx, { sub: payroll.u, tenant_id: t }, async () => {
        closeId = (await tx<{ id: string }[]>`select app.close_pay_period('2026-01-01', '2026-01-29', ${tx.json(SNAP)}, '[]'::jsonb) as id`)[0]!.id;
      });
      for (const who of [scoped, viewer, subject]) {
        await asUser(tx, { sub: who.u, tenant_id: t }, async () => {
          await expectDbError(tx, /pay\.manage required/, () => tx`select app.reopen_pay_period(${closeId}, 'trying my luck')`);
        });
      }
    });
  });

  it('posts comp credit once and the balance reflects it', async () => {
    await withAdmin(async (tx) => {
      const { t, bank, payroll, subject } = await world(tx);
      await asUser(tx, { sub: payroll.u, tenant_id: t }, async () => {
        await tx`select app.close_pay_period('2026-01-01', '2026-01-29', ${tx.json(SNAP)}, ${comp(tx, subject.m, 7.5)})`;
      });
      expect(await balance(tx, subject.m, bank)).toBe(7.5);
      const [row] = await tx<{ kind: string; effective_date: string; note: string }[]>`
        select kind, effective_date::text, note from leave_ledger where member_id = ${subject.m}`;
      expect(row).toMatchObject({ kind: 'earn', effective_date: '2026-01-28' });
      expect(row!.note).toContain('2026-01-01');
    });
  });

  it('refuses a second close of the same or an overlapping period', async () => {
    await withAdmin(async (tx) => {
      const { t, bank, payroll, subject } = await world(tx);
      await asUser(tx, { sub: payroll.u, tenant_id: t }, async () => {
        await tx`select app.close_pay_period('2026-01-01', '2026-01-29', ${tx.json(SNAP)}, ${comp(tx, subject.m, 4)})`;
        await expectDbError(tx, /overlaps a closed period/, () => tx`select app.close_pay_period('2026-01-01', '2026-01-29', ${tx.json(SNAP)}, ${comp(tx, subject.m, 4)})`);
        await expectDbError(tx, /overlaps a closed period/, () => tx`select app.close_pay_period('2026-01-15', '2026-02-12', ${tx.json(SNAP)}, '[]'::jsonb)`);
        // The next period is fine.
        await tx`select app.close_pay_period('2026-01-29', '2026-02-26', ${tx.json(SNAP)}, '[]'::jsonb)`;
      });
      expect(await balance(tx, subject.m, bank)).toBe(4);
    });
  });

  it('reopening reverses the credit exactly once, and the period can be closed again', async () => {
    await withAdmin(async (tx) => {
      const { t, bank, payroll, subject } = await world(tx);
      await asUser(tx, { sub: payroll.u, tenant_id: t }, async () => {
        const [c] = await tx<{ id: string }[]>`select app.close_pay_period('2026-01-01', '2026-01-29', ${tx.json(SNAP)}, ${comp(tx, subject.m, 6)}) as id`;
        await expectDbError(tx, /at least 5 characters/, () => tx`select app.reopen_pay_period(${c!.id}, 'no')`);
        await tx`select app.reopen_pay_period(${c!.id}, 'Missed a holdover')`;
        await expectDbError(tx, /already reopened/, () => tx`select app.reopen_pay_period(${c!.id}, 'Again please')`);
        expect(await balance(tx, subject.m, bank)).toBe(0);
        const [again] = await tx<{ id: string }[]>`select app.close_pay_period('2026-01-01', '2026-01-29', ${tx.json(SNAP)}, ${comp(tx, subject.m, 8)}) as id`;
        expect(again!.id).not.toBe(c!.id);
        expect(await balance(tx, subject.m, bank)).toBe(8);
      });
      const kinds = await tx<{ kind: string }[]>`select kind from leave_ledger where member_id = ${subject.m} order by id`;
      expect(kinds.map((k) => k.kind)).toEqual(['earn', 'reversal', 'earn']);
    });
  });

  it('knows which dates are locked', async () => {
    await withAdmin(async (tx) => {
      const { t, payroll } = await world(tx);
      await asUser(tx, { sub: payroll.u, tenant_id: t }, async () => {
        const check = async (d: string) => (await tx<{ c: boolean }[]>`select app.is_date_closed(${d}::date) as c`)[0]!.c;
        expect(await check('2026-01-10')).toBe(false);
        const [c] = await tx<{ id: string }[]>`select app.close_pay_period('2026-01-01', '2026-01-29', ${tx.json(SNAP)}, '[]'::jsonb) as id`;
        expect(await check('2026-01-01')).toBe(true);
        expect(await check('2026-01-28')).toBe(true);
        expect(await check('2026-01-29')).toBe(false);
        await tx`select app.reopen_pay_period(${c!.id}, 'Reopened for a fix')`;
        expect(await check('2026-01-10')).toBe(false);
      });
    });
  });

  it('refuses an unknown comp bank, a bad period, and rolls everything back', async () => {
    await withAdmin(async (tx) => {
      const { t, payroll, subject } = await world(tx);
      await asUser(tx, { sub: payroll.u, tenant_id: t }, async () => {
        await expectDbError(tx, /Unknown leave bank "nope"/, () => tx`select app.close_pay_period('2026-01-01', '2026-01-29', ${tx.json(SNAP)}, ${comp(tx, subject.m, 3, 'nope')})`);
        await expectDbError(tx, /invalid pay period/, () => tx`select app.close_pay_period('2026-01-29', '2026-01-01', ${tx.json(SNAP)}, '[]'::jsonb)`);
        // The failed attempt left nothing behind, so the period is still open to close.
        expect((await tx`select count(*)::int as n from pay_period_closes`)[0]!.n).toBe(0);
        await tx`select app.close_pay_period('2026-01-01', '2026-01-29', ${tx.json(SNAP)}, '[]'::jsonb)`;
      });
    });
  });

  it('cannot credit a member from another department', async () => {
    await withAdmin(async (tx) => {
      const { t, payroll } = await world(tx);
      const other = await createTenant(tx, 'Other FD');
      const stranger = await createMember(tx, other);
      await asUser(tx, { sub: payroll.u, tenant_id: t }, async () => {
        await expectDbError(tx, /unknown member/, () => tx`select app.close_pay_period('2026-01-01', '2026-01-29', ${tx.json(SNAP)}, ${comp(tx, stranger, 3)})`);
      });
    });
  });
});

describe('pay_period_closes access', () => {
  it('is readable only by pay.view / pay.manage and never writable directly', async () => {
    await withAdmin(async (tx) => {
      const { t, payroll, subject } = await world(tx);
      const viewer = await person(tx, t, { perms: ['pay.view'] });
      await asUser(tx, { sub: payroll.u, tenant_id: t }, async () => {
        await tx`select app.close_pay_period('2026-01-01', '2026-01-29', ${tx.json(SNAP)}, '[]'::jsonb)`;
        expect((await tx`select 1 from pay_period_closes`).length).toBe(1);
        await expectDbError(tx, /permission denied/, () => tx`delete from pay_period_closes`);
        await expectDbError(tx, /permission denied/, () => tx`update pay_period_closes set status = 'reopened'`);
      });
      await asUser(tx, { sub: viewer.u, tenant_id: t }, async () => {
        expect((await tx`select 1 from pay_period_closes`).length).toBe(1);
      });
      await asUser(tx, { sub: subject.u, tenant_id: t }, async () => {
        expect((await tx`select 1 from pay_period_closes`).length).toBe(0);
      });
    });
  });

  it('is tenant isolated', async () => {
    await withAdmin(async (tx) => {
      const a = await world(tx);
      const b = await world(tx);
      await tx`insert into pay_period_closes (tenant_id, period_start, period_end, snapshot) values (${a.t}, '2026-01-01', '2026-01-29', '{}')`;
      await tx`insert into pay_period_closes (tenant_id, period_start, period_end, snapshot) values (${b.t}, '2026-01-01', '2026-01-29', '{}')`;
      await asUser(tx, { sub: a.payroll.u, tenant_id: a.t }, async () => {
        const rows = await tx<{ tenant_id: string }[]>`select tenant_id from pay_period_closes`;
        expect(rows.map((r) => r.tenant_id)).toEqual([a.t]);
      });
    });
  });
});
