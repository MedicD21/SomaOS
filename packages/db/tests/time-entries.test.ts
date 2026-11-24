import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { createMember, createOrgUnit, createRole, createTenant, grantRole, userInTenant } from './helpers';

afterAll(closeTestDb);

async function person(tx: Tx, t: string, opts: { perms?: string[]; scope?: Parameters<typeof grantRole>[4] } = {}) {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u });
  if (opts.perms?.length) await grantRole(tx, t, m, await createRole(tx, t, `r_${m.slice(0, 6)}`, opts.perms), opts.scope);
  return { u, m };
}

async function assign(tx: Tx, t: string, member: string, unit: string, shift: string) {
  await tx`insert into member_assignments (tenant_id, member_id, org_unit_id, shift_id, effective)
           values (${t}, ${member}, ${unit}, ${shift}, '[2020-01-01,)')`;
}

async function world(tx: Tx) {
  const t = await createTenant(tx);
  const s1 = await createOrgUnit(tx, t, 'Station 1');
  const s2 = await createOrgUnit(tx, t, 'Station 2');
  const [a] = await tx<{ id: string }[]>`insert into shifts (tenant_id, key, label) values (${t}, 'a', 'A') returning id`;
  const [b] = await tx<{ id: string }[]>`insert into shifts (tenant_id, key, label) values (${t}, 'b', 'B') returning id`;

  const subject = await person(tx, t);                                   // Station 1, shift B
  await assign(tx, t, subject.m, s1, b!.id);
  const elsewhere = await person(tx, t);                                 // Station 2, shift B
  await assign(tx, t, elsewhere.m, s2, b!.id);
  const otherShift = await person(tx, t);                                // Station 1, shift A
  await assign(tx, t, otherShift.m, s1, a!.id);

  const officer = await person(tx, t, { perms: ['scheduling.roster.edit'], scope: { scopeKind: 'org_unit', orgUnitId: s1, shiftId: b!.id } });
  await assign(tx, t, officer.m, s1, b!.id);
  const stationOfficer = await person(tx, t, { perms: ['scheduling.roster.edit'], scope: { scopeKind: 'org_unit', orgUnitId: s1 } });
  const payroll = await person(tx, t, { perms: ['pay.manage'] });
  const viewer = await person(tx, t, { perms: ['pay.view'] });
  return { t, subject, elsewhere, otherShift, officer, stationOfficer, payroll, viewer };
}

const add = (tx: Tx, member: string, date = '2026-01-10', hours = 3, type = 'holdover', reason = 'Held over for a late call') =>
  tx<{ id: string }[]>`select app.add_time_entry(${member}, ${date}::date, ${hours}, ${type}, ${reason}) as id`;

describe('recording time', () => {
  it('a scoped officer covers their station and shift only', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await asUser(tx, { sub: w.officer.u, tenant_id: w.t }, async () => {
        const [e] = await add(tx, w.subject.m);
        expect(e!.id).toBeTruthy();
        await expectDbError(tx, /cannot record time for this member/, () => add(tx, w.elsewhere.m));
        await expectDbError(tx, /cannot record time for this member/, () => add(tx, w.otherShift.m));
      });
      // The same officer without the shift limit also covers the other shift at the station.
      await asUser(tx, { sub: w.stationOfficer.u, tenant_id: w.t }, async () => {
        await add(tx, w.subject.m);
        await add(tx, w.otherShift.m);
        await expectDbError(tx, /cannot record time for this member/, () => add(tx, w.elsewhere.m));
      });
    });
  });

  it('nobody records time for themselves, even payroll and officers', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      for (const who of [w.officer, w.payroll, w.subject]) {
        await asUser(tx, { sub: who.u, tenant_id: w.t }, async () => {
          await expectDbError(tx, /cannot record time for this member/, () => add(tx, who.m));
        });
      }
    });
  });

  it('payroll (department-wide pay.manage) can record for anyone; pay.view cannot', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await asUser(tx, { sub: w.payroll.u, tenant_id: w.t }, async () => {
        await add(tx, w.elsewhere.m);
        await add(tx, w.subject.m);
      });
      await asUser(tx, { sub: w.viewer.u, tenant_id: w.t }, async () => {
        await expectDbError(tx, /cannot record time for this member/, () => add(tx, w.subject.m));
      });
    });
  });

  it('validates hours, type, reason and member', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const other = await createTenant(tx, 'Other FD');
      const stranger = await createMember(tx, other);
      await asUser(tx, { sub: w.payroll.u, tenant_id: w.t }, async () => {
        await expectDbError(tx, /more than 0 and at most 48/, () => add(tx, w.subject.m, '2026-01-10', 0));
        await expectDbError(tx, /more than 0 and at most 48/, () => add(tx, w.subject.m, '2026-01-10', 49));
        await expectDbError(tx, /unknown work type/, () => add(tx, w.subject.m, '2026-01-10', 2, 'bonus'));
        await expectDbError(tx, /at least 5 characters/, () => add(tx, w.subject.m, '2026-01-10', 2, 'holdover', 'no'));
        await expectDbError(tx, /unknown member/, () => add(tx, stranger));
      });
    });
  });

  it('is refused inside a closed pay period, for add and void', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let entry = '';
      await asUser(tx, { sub: w.payroll.u, tenant_id: w.t }, async () => {
        entry = (await add(tx, w.subject.m, '2026-01-10'))[0]!.id;
        const [c] = await tx<{ id: string }[]>`select app.close_pay_period('2026-01-01', '2026-01-29', '{}'::jsonb, '[]'::jsonb) as id`;
        await expectDbError(tx, /pay period is closed/, () => add(tx, w.subject.m, '2026-01-10'));
        await expectDbError(tx, /pay period is closed/, () => tx`select app.void_time_entry(${entry}, 'Entered by mistake')`);
        await add(tx, w.subject.m, '2026-01-29'); // first day after the period
        await tx`select app.reopen_pay_period(${c!.id}, 'Reopened for a correction')`;
        await tx`select app.void_time_entry(${entry}, 'Entered by mistake')`;
      });
    });
  });
});

describe('voiding time', () => {
  it('keeps the row, records who and why, and cannot be repeated', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await asUser(tx, { sub: w.officer.u, tenant_id: w.t }, async () => {
        const [e] = await add(tx, w.subject.m);
        await expectDbError(tx, /at least 5 characters/, () => tx`select app.void_time_entry(${e!.id}, 'no')`);
        await tx`select app.void_time_entry(${e!.id}, 'Wrong date entered')`;
        await expectDbError(tx, /already void/, () => tx`select app.void_time_entry(${e!.id}, 'Wrong date entered')`);
        const [row] = await tx<{ status: string; void_reason: string; voided_by: string }[]>`select status, void_reason, voided_by from time_entries where id = ${e!.id}`;
        expect(row).toMatchObject({ status: 'void', void_reason: 'Wrong date entered', voided_by: w.officer.u });
      });
    });
  });

  it('only someone who could record the time can void it', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let id = '';
      await asUser(tx, { sub: w.payroll.u, tenant_id: w.t }, async () => {
        id = (await add(tx, w.elsewhere.m))[0]!.id;
      });
      await asUser(tx, { sub: w.officer.u, tenant_id: w.t }, async () => {
        await expectDbError(tx, /cannot change time for this member/, () => tx`select app.void_time_entry(${id}, 'Not my station')`);
      });
      await asUser(tx, { sub: w.elsewhere.u, tenant_id: w.t }, async () => {
        await expectDbError(tx, /cannot change time for this member/, () => tx`select app.void_time_entry(${id}, 'Trying my own')`);
      });
    });
  });
});

describe('who can see time entries', () => {
  it('members their own, officers those they cover, payroll and pay.view all; no direct writes', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await asUser(tx, { sub: w.payroll.u, tenant_id: w.t }, async () => {
        await add(tx, w.subject.m);
        await add(tx, w.elsewhere.m);
      });
      const count = async (who: { u: string }) => asUser(tx, { sub: who.u, tenant_id: w.t }, async () => (await tx`select 1 from time_entries`).length);
      expect(await count(w.subject)).toBe(1);
      expect(await count(w.elsewhere)).toBe(1);
      expect(await count(w.otherShift)).toBe(0);
      expect(await count(w.officer)).toBe(1);
      expect(await count(w.stationOfficer)).toBe(1);
      expect(await count(w.payroll)).toBe(2);
      expect(await count(w.viewer)).toBe(2);
      await asUser(tx, { sub: w.payroll.u, tenant_id: w.t }, async () => {
        await expectDbError(tx, /permission denied/, () => tx`delete from time_entries`);
        await expectDbError(tx, /permission denied/, () => tx`update time_entries set hours = 1`);
        await expectDbError(tx, /permission denied/, () => tx`insert into time_entries (tenant_id, member_id, work_date, hours, type, reason) values (${w.t}, ${w.subject.m}, '2026-01-10', 1, 'regular', 'sneaky insert')`);
      });
    });
  });

  it('is tenant isolated', async () => {
    await withAdmin(async (tx) => {
      const a = await world(tx);
      const b = await world(tx);
      for (const w of [a, b]) {
        await asUser(tx, { sub: w.payroll.u, tenant_id: w.t }, async () => void (await add(tx, w.subject.m)));
      }
      await asUser(tx, { sub: a.payroll.u, tenant_id: a.t }, async () => {
        const rows = await tx<{ tenant_id: string }[]>`select tenant_id from time_entries`;
        expect(rows.map((r) => r.tenant_id)).toEqual([a.t]);
        await expectDbError(tx, /unknown member/, () => add(tx, b.subject.m));
      });
    });
  });
});
