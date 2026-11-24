import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import {
  addLedger, createBank, createLeaveType, createMember, createOrgUnit, createRole, createSeat, createTenant,
  grantRole, userInTenant,
} from './helpers';

afterAll(closeTestDb);

const TZ = 'America/Chicago';
const OFFSETS = [30, 33, 36, 39]; // shift start days from today
const KELLY_OFFSET = 31;

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

/** A 24-hour shift starting 07:00 local, `offset` days from today (wall-clock 24 h, DST-proof). */
async function addShift(tx: Tx, t: string, member: string, seat: string | null, offset: number, type = 'regular') {
  await tx`
    insert into shift_assignments (tenant_id, member_id, seat_id, during, type, source)
    values (${t}, ${member}, ${seat},
      tstzrange(((current_date + ${offset}::int)::timestamp + time '07:00') at time zone ${TZ},
                ((current_date + ${offset + 1}::int)::timestamp + time '07:00') at time zone ${TZ}),
      ${type}, 'manual')`;
}

async function world(tx: Tx) {
  const t = await createTenant(tx, 'Leave FD', TZ);
  const s1 = await createOrgUnit(tx, t, 'Station 1');
  const s2 = await createOrgUnit(tx, t, 'Station 2');
  const [a] = await tx<{ id: string }[]>`insert into shifts (tenant_id, key, label) values (${t}, 'a', 'A') returning id`;
  const [b] = await tx<{ id: string }[]>`insert into shifts (tenant_id, key, label) values (${t}, 'b', 'B') returning id`;
  const bank = await createBank(tx, t, 'vacation');
  const type = await createLeaveType(tx, t, bank, 'vacation');
  const seat1 = await createSeat(tx, t, s1, 'S1 seat');
  const seat2 = await createSeat(tx, t, s2, 'S2 seat');

  const me = await person(tx, t, { perms: ['leave.request'] });          // S1 / B
  await assign(tx, t, me.m, s1, b!.id);
  for (const o of OFFSETS) await addShift(tx, t, me.m, seat1, o);
  await addShift(tx, t, me.m, null, KELLY_OFFSET, 'kelly');

  const other = await person(tx, t, { perms: ['leave.request'] });       // S2 / B
  await assign(tx, t, other.m, s2, b!.id);
  await addShift(tx, t, other.m, seat2, OFFSETS[0]!);

  const aShift = await person(tx, t, { perms: ['leave.request'] });      // S1 / A
  await assign(tx, t, aShift.m, s1, a!.id);
  await addShift(tx, t, aShift.m, seat1, OFFSETS[0]! + 100);

  const dept = await person(tx, t, { perms: ['leave.approve'] });        // department approver
  const captain = await person(tx, t, { perms: ['leave.approve'], scope: { scopeKind: 'org_unit', orgUnitId: s1, shiftId: b!.id } });
  return { t, s1, s2, a: a!.id, b: b!.id, bank, type, seat1, seat2, me, other, aShift, dept, captain };
}

const iso = async (tx: Tx, offset: number) => (await tx<{ d: string }[]>`select (current_date + ${offset}::int)::text as d`)[0]!.d;

async function request(tx: Tx, w: Awaited<ReturnType<typeof world>>, who: { u: string }, from: number, to: number, type = w.type): Promise<string> {
  const start = await iso(tx, from);
  const end = await iso(tx, to);
  let id = '';
  await asUser(tx, { sub: who.u, tenant_id: w.t }, async () => {
    id = (await tx`select app.request_leave(${type}, ${start}::date, ${end}::date, 'family trip') as id`)[0]!.id as string;
  });
  return id;
}

/** Asserts a leave request fails; the assertion runs inside the user context so the real error is seen. */
async function requestFails(
  tx: Tx, w: Awaited<ReturnType<typeof world>>, who: { u: string }, from: number, to: number, pattern: RegExp, type = w.type,
): Promise<void> {
  const start = await iso(tx, from);
  const end = await iso(tx, to);
  await asUser(tx, { sub: who.u, tenant_id: w.t }, async () => {
    await expectDbError(tx, pattern, () => tx`select app.request_leave(${type}, ${start}::date, ${end}::date, 'x')`);
  });
}

const approvePolicy = (tx: Tx, w: { t: string }, key: string, payload: object) =>
  tx`insert into config_versions (tenant_id, kind, key, version, status, effective, payload)
     values (${w.t}, 'leave.accrual', ${key}, 1, 'approved', tstzrange(now() - interval '1 day', null), ${tx.json(payload as never)})`;

describe('request_leave', () => {
  it('computes hours from scheduled non-Kelly shifts in range', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await addLedger(tx, w.t, w.me.m, w.bank, 'adjust', 200);
      const id = await request(tx, w, w.me, OFFSETS[0]!, OFFSETS[2]!); // 3 shifts + a Kelly day inside the range
      const [r] = await tx`select hours::float8 as hours, status from leave_requests where id = ${id}`;
      expect(r).toMatchObject({ hours: 72, status: 'pending' });
    });
  });

  it('rejects a range with no scheduled shifts', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await addLedger(tx, w.t, w.me.m, w.bank, 'adjust', 200);
      await asUser(tx, { sub: w.me.u, tenant_id: w.t }, async () => {
        await expectDbError(tx, /No scheduled shifts in that range/, () =>
          tx`select app.request_leave(${w.type}, current_date + 1, current_date + 2, null)`);
      });
    });
  });

  it('enforces the leave type lead time', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const strict = await createLeaveType(tx, w.t, null, 'personal');
      await tx`update leave_types set lead_time_days = 60 where id = ${strict}`;
      await requestFails(tx, w, w.me, OFFSETS[0]!, OFFSETS[0]!, /lead time/, strict);
    });
  });

  it('refuses when the balance is short, counting other pending requests', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await addLedger(tx, w.t, w.me.m, w.bank, 'adjust', 80);
      await approvePolicy(tx, w, 'vacation', { negativeAllowed: false });
      await request(tx, w, w.me, OFFSETS[0]!, OFFSETS[2]!); // 72 h pending
      await requestFails(tx, w, w.me, OFFSETS[3]!, OFFSETS[3]!, /insufficient balance/); // needs 24, 8 left
    });
  });

  it('allows going negative when the approved policy says so', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await approvePolicy(tx, w, 'vacation', { negativeAllowed: true });
      await request(tx, w, w.me, OFFSETS[0]!, OFFSETS[0]!);
    });
  });

  it('treats a bank without an approved policy as not allowed to go negative', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await requestFails(tx, w, w.me, OFFSETS[0]!, OFFSETS[0]!, /insufficient balance/);
    });
  });

  it('lets types without a bank through with no balance check', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const fmla = await createLeaveType(tx, w.t, null, 'fmla');
      await request(tx, w, w.me, OFFSETS[0]!, OFFSETS[0]!, fmla);
    });
  });

  it('only members with leave.request can ask, and only for themselves', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await requestFails(tx, w, w.dept, OFFSETS[0]!, OFFSETS[0]!, /leave.request required/);
    });
  });
});

describe('decide_leave', () => {
  it('approval debits the ledger, frees exactly the shifts in range and notifies the member', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await addLedger(tx, w.t, w.me.m, w.bank, 'adjust', 200);
      await approvePolicy(tx, w, 'vacation', { negativeAllowed: false });
      const id = await request(tx, w, w.me, OFFSETS[0]!, OFFSETS[2]!);
      await asUser(tx, { sub: w.dept.u, tenant_id: w.t }, async () => {
        await tx`select app.decide_leave(${id}, true, 'enjoy')`;
      });
      const [req] = await tx`select status, hours::float8 as hours, decision_note from leave_requests where id = ${id}`;
      expect(req).toMatchObject({ status: 'approved', hours: 72, decision_note: 'enjoy' });
      const [bal] = await tx`select sum(hours)::float8 as h from leave_ledger where member_id = ${w.me.m}`;
      expect(bal!.h).toBe(128);
      const freed = await tx`select status, cancelled_reason from shift_assignments where leave_request_id = ${id}`;
      expect(freed).toHaveLength(3);
      expect(freed.every((r) => r.status === 'cancelled' && /^Leave: /.test(r.cancelled_reason))).toBe(true);
      const [left] = await tx`select count(*)::int as n from shift_assignments where member_id = ${w.me.m} and status = 'scheduled' and type <> 'kelly'`;
      expect(left!.n).toBe(1); // the shift outside the range
      const [kelly] = await tx`select status from shift_assignments where member_id = ${w.me.m} and type = 'kelly'`;
      expect(kelly!.status).toBe('scheduled');
      const [note] = await tx`select count(*)::int as n from notifications where member_id = ${w.me.m} and kind = 'leave.decided'`;
      expect(note!.n).toBe(1);
    });
  });

  it('a captain scoped to Station 1 / B shift decides only inside that scope', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await approvePolicy(tx, w, 'vacation', { negativeAllowed: true });
      const mine = await request(tx, w, w.me, OFFSETS[0]!, OFFSETS[0]!);              // S1 / B
      const otherStation = await request(tx, w, w.other, OFFSETS[0]!, OFFSETS[0]!);   // S2 / B
      const otherShift = await request(tx, w, w.aShift, OFFSETS[0]! + 100, OFFSETS[0]! + 100); // S1 / A
      await asUser(tx, { sub: w.captain.u, tenant_id: w.t }, async () => {
        await expectDbError(tx, /not in your scope/, () => tx`select app.decide_leave(${otherStation}, true, null)`);
        await expectDbError(tx, /not in your scope/, () => tx`select app.decide_leave(${otherShift}, true, null)`);
        await expectDbError(tx, /not in your scope/, () => tx`select app.decide_leave(${crypto.randomUUID()}, true, null)`);
        await tx`select app.decide_leave(${mine}, true, null)`;
      });
      await asUser(tx, { sub: w.dept.u, tenant_id: w.t }, async () => {
        await tx`select app.decide_leave(${otherStation}, true, null)`;
      });
    });
  });

  it('uses the standing seat (station and platoon) when a member has no primary assignment', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await approvePolicy(tx, w, 'vacation', { negativeAllowed: true });
      const seated = await person(tx, w.t, { perms: ['leave.request'] });   // no member_assignments row
      await tx`insert into standing_seats (tenant_id, member_id, seat_id, platoon_shift_id, effective)
               values (${w.t}, ${seated.m}, ${w.seat1}, ${w.b}, '[2020-01-01,)')`;
      await addShift(tx, w.t, seated.m, w.seat1, 70);
      const id = await request(tx, w, seated, 70, 70);
      const otherCaptain = await person(tx, w.t, { perms: ['leave.approve'], scope: { scopeKind: 'org_unit', orgUnitId: w.s2, shiftId: w.b } });
      await asUser(tx, { sub: otherCaptain.u, tenant_id: w.t }, async () => {
        await expectDbError(tx, /not in your scope/, () => tx`select app.decide_leave(${id}, true, null)`);
      });
      await asUser(tx, { sub: w.captain.u, tenant_id: w.t }, async () => {      // Station 1 / B shift
        await tx`select app.decide_leave(${id}, true, null)`;
      });
      expect((await tx`select status from leave_requests where id = ${id}`)[0]!.status).toBe('approved');
    });
  });

  it('nobody approves their own request, and requesters cannot decide', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await approvePolicy(tx, w, 'vacation', { negativeAllowed: true });
      const boss = await person(tx, w.t, { perms: ['leave.request', 'leave.approve'] });
      const [shiftRow] = await tx<{ id: string }[]>`insert into shifts (tenant_id, key, label) values (${w.t}, 'c', 'C') returning id`;
      await assign(tx, w.t, boss.m, w.s1, shiftRow!.id);
      await addShift(tx, w.t, boss.m, w.seat1, 60);
      const own = await request(tx, w, boss, 60, 60);
      const mine = await request(tx, w, w.me, OFFSETS[0]!, OFFSETS[0]!);
      await asUser(tx, { sub: boss.u, tenant_id: w.t }, async () => {
        await expectDbError(tx, /not in your scope/, () => tx`select app.decide_leave(${own}, true, null)`);
      });
      await asUser(tx, { sub: w.me.u, tenant_id: w.t }, async () => {
        await expectDbError(tx, /not in your scope/, () => tx`select app.decide_leave(${mine}, true, null)`);
      });
    });
  });

  it('denying needs a reason, changes nothing else and cannot be repeated', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await approvePolicy(tx, w, 'vacation', { negativeAllowed: true });
      const id = await request(tx, w, w.me, OFFSETS[0]!, OFFSETS[0]!);
      await asUser(tx, { sub: w.dept.u, tenant_id: w.t }, async () => {
        await expectDbError(tx, /reason is required/, () => tx`select app.decide_leave(${id}, false, 'no')`);
        await tx`select app.decide_leave(${id}, false, 'staffing shortage')`;
        await expectDbError(tx, /already denied/, () => tx`select app.decide_leave(${id}, true, null)`);
      });
      expect((await tx`select count(*)::int as n from leave_ledger where member_id = ${w.me.m} and kind = 'use'`)[0]!.n).toBe(0);
      expect((await tx`select count(*)::int as n from shift_assignments where leave_request_id = ${id}`)[0]!.n).toBe(0);
    });
  });

  it('re-checks the balance at approval time', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await addLedger(tx, w.t, w.me.m, w.bank, 'adjust', 30);
      await approvePolicy(tx, w, 'vacation', { negativeAllowed: false });
      const id = await request(tx, w, w.me, OFFSETS[0]!, OFFSETS[0]!); // 24 h of 30
      await addLedger(tx, w.t, w.me.m, w.bank, 'adjust', -20);          // balance drops to 10 before approval
      await asUser(tx, { sub: w.dept.u, tenant_id: w.t }, async () => {
        await expectDbError(tx, /insufficient balance/, () => tx`select app.decide_leave(${id}, true, null)`);
      });
    });
  });
});

describe('cancel_leave', () => {
  async function approved(tx: Tx) {
    const w = await world(tx);
    await addLedger(tx, w.t, w.me.m, w.bank, 'adjust', 200);
    await approvePolicy(tx, w, 'vacation', { negativeAllowed: false });
    const id = await request(tx, w, w.me, OFFSETS[0]!, OFFSETS[2]!);
    await asUser(tx, { sub: w.dept.u, tenant_id: w.t }, async () => {
      await tx`select app.decide_leave(${id}, true, null)`;
    });
    return { w, id };
  }
  const balance = async (tx: Tx, member: string) =>
    (await tx`select coalesce(sum(hours), 0)::float8 as h from leave_ledger where member_id = ${member}`)[0]!.h as number;

  it('reverses the ledger once and restores the shifts', async () => {
    await withAdmin(async (tx) => {
      const { w, id } = await approved(tx);
      expect(await balance(tx, w.me.m)).toBe(128);
      await asUser(tx, { sub: w.me.u, tenant_id: w.t }, async () => {
        await tx`select app.cancel_leave(${id}, 'plans changed')`;
        await expectDbError(tx, /already cancelled/, () => tx`select app.cancel_leave(${id}, 'again')`);
      });
      expect(await balance(tx, w.me.m)).toBe(200);
      expect((await tx`select count(*)::int as n from leave_ledger where request_id = ${id} and kind = 'reversal'`)[0]!.n).toBe(1);
      const [n] = await tx`select count(*)::int as n from shift_assignments where member_id = ${w.me.m} and status = 'scheduled' and type <> 'kelly'`;
      expect(n!.n).toBe(4);
      expect((await tx`select count(*)::int as n from shift_assignments where leave_request_id = ${id}`)[0]!.n).toBe(0);
    });
  });

  it('fails cleanly when a freed seat was refilled meanwhile', async () => {
    await withAdmin(async (tx) => {
      const { w, id } = await approved(tx);
      await addShift(tx, w.t, w.other.m, w.seat1, OFFSETS[1]!); // someone else now holds S1's seat on the 2nd day
      await asUser(tx, { sub: w.dept.u, tenant_id: w.t }, async () => {
        await expectDbError(tx, /seat was refilled/, () => tx`select app.cancel_leave(${id}, 'reverse it')`);
      });
      expect((await tx`select status from leave_requests where id = ${id}`)[0]!.status).toBe('approved');
      expect(await balance(tx, w.me.m)).toBe(128);
    });
  });

  it('a pending request can be cancelled by its owner and only by owner or approver', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await approvePolicy(tx, w, 'vacation', { negativeAllowed: true });
      const id = await request(tx, w, w.me, OFFSETS[0]!, OFFSETS[0]!);
      await asUser(tx, { sub: w.other.u, tenant_id: w.t }, async () => {
        await expectDbError(tx, /not in your scope/, () => tx`select app.cancel_leave(${id}, 'sneaky')`);
      });
      await asUser(tx, { sub: w.me.u, tenant_id: w.t }, async () => {
        await tx`select app.cancel_leave(${id}, 'changed my mind')`;
      });
      expect((await tx`select status from leave_requests where id = ${id}`)[0]!.status).toBe('cancelled');
      expect(await balance(tx, w.me.m)).toBe(0);
    });
  });
});

describe('adjust_leave', () => {
  it('needs department-wide leave.manage and a real note', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const mgr = await person(tx, w.t, { perms: ['leave.manage'] });
      const scoped = await person(tx, w.t, { perms: ['leave.manage'], scope: { scopeKind: 'org_unit', orgUnitId: w.s1 } });
      await asUser(tx, { sub: scoped.u, tenant_id: w.t }, async () => {
        await expectDbError(tx, /leave.manage required/, () => tx`select app.adjust_leave(${w.me.m}, ${w.bank}, 8, 'opening balance')`);
      });
      await asUser(tx, { sub: mgr.u, tenant_id: w.t }, async () => {
        await expectDbError(tx, /explain the adjustment/, () => tx`select app.adjust_leave(${w.me.m}, ${w.bank}, 8, 'ok')`);
        await expectDbError(tx, /non-zero/, () => tx`select app.adjust_leave(${w.me.m}, ${w.bank}, 0, 'opening balance')`);
        await tx`select app.adjust_leave(${w.me.m}, ${w.bank}, 8, 'opening balance')`;
      });
      const [row] = await tx`select kind, hours::float8 as hours, note from leave_ledger where member_id = ${w.me.m}`;
      expect(row).toMatchObject({ kind: 'adjust', hours: 8, note: 'opening balance' });
    });
  });
});

describe('leave_requests_in_scope', () => {
  it('lists only pending requests the caller may decide', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await approvePolicy(tx, w, 'vacation', { negativeAllowed: true });
      const mine = await request(tx, w, w.me, OFFSETS[0]!, OFFSETS[0]!);
      await request(tx, w, w.other, OFFSETS[0]!, OFFSETS[0]!);
      await request(tx, w, w.aShift, OFFSETS[0]! + 100, OFFSETS[0]! + 100);
      await asUser(tx, { sub: w.captain.u, tenant_id: w.t }, async () => {
        const rows = await tx`select request_id from app.leave_requests_in_scope('pending')`;
        expect(rows.map((r) => r.request_id)).toEqual([mine]);
      });
      await asUser(tx, { sub: w.dept.u, tenant_id: w.t }, async () => {
        expect((await tx`select * from app.leave_requests_in_scope('pending')`).length).toBe(3);
      });
      await asUser(tx, { sub: w.me.u, tenant_id: w.t }, async () => {
        expect((await tx`select * from app.leave_requests_in_scope('pending')`).length).toBe(0);
      });
    });
  });
});
