import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { createBank, createLeaveType, createMember, createOrgUnit, createRole, createSeat, createTenant, grantRole, userInTenant } from './helpers';

afterAll(closeTestDb);

const TZ = 'America/Chicago';

async function person(tx: Tx, t: string, perms: string[]) {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u });
  await grantRole(tx, t, m, await createRole(tx, t, `r_${m.slice(0, 6)}`, perms));
  return { u, m };
}

/** One 24-hour shift starting 07:00 local, 30 days out. */
async function addShift(tx: Tx, t: string, member: string, seat: string) {
  await tx`
    insert into shift_assignments (tenant_id, member_id, seat_id, during, type, source)
    values (${t}, ${member}, ${seat},
      tstzrange(((current_date + 30)::timestamp + time '07:00') at time zone ${TZ},
                ((current_date + 31)::timestamp + time '07:00') at time zone ${TZ}),
      'regular', 'manual')`;
}

async function world(tx: Tx) {
  const t = await createTenant(tx, 'Audience FD', TZ);
  const bank = await createBank(tx, t, 'sick');
  const crewType = await createLeaveType(tx, t, null, 'jury_duty');
  const officerType = await createLeaveType(tx, t, null, 'admin_leave');
  await tx`update leave_types set audience = 'officer' where id = ${officerType}`;
  const crew = await person(tx, t, ['leave.request']);
  const officer = await person(tx, t, ['leave.request', 'leave.approve']);
  const manager = await person(tx, t, ['leave.request', 'leave.manage']);
  const unit = await createOrgUnit(tx, t, 'Station 1');
  for (const [i, p] of [crew, officer, manager].entries()) await addShift(tx, t, p.m, await createSeat(tx, t, unit, `Seat ${i}`));
  return { t, bank, crewType, officerType, crew, officer, manager };
}

const requestAs = (tx: Tx, w: { t: string }, who: { u: string }, type: string) =>
  asUser(tx, { sub: who.u, tenant_id: w.t }, () =>
    tx`select app.request_leave(${type}, current_date + 30, current_date + 30, null) as id`);

describe('leave type audience', () => {
  it('defaults to member and accepts only member or officer', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx, 'Default FD', TZ);
      const id = await createLeaveType(tx, t, null, 'vacation');
      const [r] = await tx`select audience from leave_types where id = ${id}`;
      expect(r!.audience).toBe('member');
      await expectDbError(tx, /leave_types_audience_check/, () => tx`update leave_types set audience = 'everyone' where id = ${id}`);
    });
  });

  it('lets a crew member request a member type but not an officer type', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await requestAs(tx, w, w.crew, w.crewType);
      await asUser(tx, { sub: w.crew.u, tenant_id: w.t }, async () => {
        await expectDbError(tx, /unknown leave type/, () =>
          tx`select app.request_leave(${w.officerType}, current_date + 30, current_date + 30, null)`);
      });
    });
  });

  it('lets approvers and leave managers request officer types', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await requestAs(tx, w, w.officer, w.officerType);
      await requestAs(tx, w, w.manager, w.officerType);
      const [r] = await tx`select count(*)::int as n from leave_requests where leave_type_id = ${w.officerType}`;
      expect(r!.n).toBe(2);
    });
  });

  it('reports which callers may use officer types', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const sees = async (who: { u: string }) => {
        let v: boolean | undefined;
        await asUser(tx, { sub: who.u, tenant_id: w.t }, async () => {
          v = (await tx<{ v: boolean }[]>`select app.can_use_officer_leave() as v`)[0]!.v;
        });
        return v;
      };
      expect(await sees(w.crew)).toBe(false);
      expect(await sees(w.officer)).toBe(true);
      expect(await sees(w.manager)).toBe(true);
    });
  });

  it('lets an approver still decide a crew request after the type becomes officer-only', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const [req] = await requestAs(tx, w, w.crew, w.crewType);
      await tx`update leave_types set audience = 'officer' where id = ${w.crewType}`;
      await asUser(tx, { sub: w.officer.u, tenant_id: w.t }, () => tx`select app.decide_leave(${req!.id}, true, null)`);
      const [r] = await tx`select status from leave_requests where id = ${req!.id}`;
      expect(r!.status).toBe('approved');
    });
  });
});
