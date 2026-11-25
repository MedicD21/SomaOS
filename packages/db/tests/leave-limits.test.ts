import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import {
  addLedger, createBank, createLeaveRequest, createLeaveType, createMember, createOrgUnit, createRole, createSeat, createTenant,
  expectTenantIsolation, grantRole, userInTenant,
} from './helpers';

afterAll(closeTestDb);

const TZ = 'America/Chicago';
const OFFSET = 40; // days from today of the leave used below

async function person(tx: Tx, t: string, opts: { perms?: string[]; scope?: Parameters<typeof grantRole>[4] } = {}) {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u });
  if (opts.perms?.length) await grantRole(tx, t, m, await createRole(tx, t, `r_${m.slice(0, 6)}`, opts.perms), opts.scope);
  return { u, m };
}

async function place(tx: Tx, t: string, member: string, unit: string, shift: string) {
  await tx`insert into member_assignments (tenant_id, member_id, org_unit_id, shift_id, effective) values (${t}, ${member}, ${unit}, ${shift}, '[2020-01-01,)')`;
}

/** A 24 h shift starting 07:00 local, `offset` days from today, so approval has hours to debit. */
async function shiftOn(tx: Tx, t: string, member: string, seat: string, offset: number) {
  await tx`insert into shift_assignments (tenant_id, member_id, seat_id, during, type, source)
           values (${t}, ${member}, ${seat},
             tstzrange(((current_date + ${offset}::int)::timestamp + time '07:00') at time zone ${TZ}, ((current_date + ${offset + 1}::int)::timestamp + time '07:00') at time zone ${TZ}),
             'regular', 'manual')`;
}

async function world(tx: Tx) {
  const t = await createTenant(tx, 'Limit FD', TZ);
  const s1 = await createOrgUnit(tx, t, 'Station 1');
  const s2 = await createOrgUnit(tx, t, 'Station 2');
  const [a] = await tx<{ id: string }[]>`insert into shifts (tenant_id, key, label) values (${t}, 'a', 'A') returning id`;
  const [b] = await tx<{ id: string }[]>`insert into shifts (tenant_id, key, label) values (${t}, 'b', 'B') returning id`;
  const bank = await createBank(tx, t, 'vacation');
  const vac = await createLeaveType(tx, t, bank, 'vacation');
  const sick = await createLeaveType(tx, t, null, 'sick');
  const officer = await person(tx, t, { perms: ['leave.approve'] });                     // department approver, no manage
  const manager = await person(tx, t, { perms: ['leave.approve', 'leave.manage'] });
  const members: { u: string; m: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const p = await person(tx, t, { perms: ['leave.request'] });
    await place(tx, t, p.m, s1, b!.id);                                                  // Station 1, shift B
    await addLedger(tx, t, p.m, bank, 'earn', 500);
    await shiftOn(tx, t, p.m, await createSeat(tx, t, s1, `seat ${i}`), OFFSET);
    members.push(p);
  }
  const other = await person(tx, t, { perms: ['leave.request'] });                       // Station 2, shift A
  await place(tx, t, other.m, s2, a!.id);
  await addLedger(tx, t, other.m, bank, 'earn', 500);
  await shiftOn(tx, t, other.m, await createSeat(tx, t, s2, 'seat other'), OFFSET);
  return { t, s1, s2, shiftA: a!.id, shiftB: b!.id, bank, vac, sick, officer, manager, members, other };
}

const limit = (tx: Tx, t: string, o: { unit?: string | null; shift?: string | null; type?: string | null; max: number; effective?: string; label?: string }) =>
  tx`insert into leave_limits (tenant_id, label, scope_kind, org_unit_id, shift_id, leave_type_id, max_concurrent, effective)
     values (${t}, ${o.label ?? 'Cap'}, ${o.unit ? 'org_unit' : 'department'}, ${o.unit ?? null}, ${o.shift ?? null}, ${o.type ?? null}, ${o.max},
             ${o.effective ?? '[2020-01-01,)'}::daterange)`;

const dateOf = async (tx: Tx, offset = OFFSET) => (await tx<{ d: string }[]>`select (current_date + ${offset}::int)::text as d`)[0]!.d;

async function leaveFor(tx: Tx, t: string, member: string, type: string, status: 'pending' | 'approved' | 'denied' | 'cancelled') {
  const d = await dateOf(tx);
  return createLeaveRequest(tx, t, member, type, d, d, status, 24);
}

const as = <T>(tx: Tx, w: { t: string }, who: { u: string }, fn: () => Promise<T>) => asUser(tx, { sub: who.u, tenant_id: w.t }, fn);
const decide = (tx: Tx, req: string, note: string | null = null, override: string | null = null) =>
  tx`select app.decide_leave(${req}, true, ${note}, ${override})`;
const check = async (tx: Tx, member: string, type: string) => {
  const d = await dateOf(tx);
  return tx<{ day: string; max_concurrent: number; on_leave: number; over: boolean }[]>`
    select day::text, max_concurrent, on_leave, over from app.leave_limit_check(${member}, ${d}::date, ${d}::date, ${type})`;
};

describe('leave limit boundaries', () => {
  it('allows approval exactly at the limit and refuses one over', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await limit(tx, w.t, { max: 2, label: 'Department cap' });
      await leaveFor(tx, w.t, w.members[0]!.m, w.vac, 'approved');
      const second = await leaveFor(tx, w.t, w.members[1]!.m, w.vac, 'pending');
      await as(tx, w, w.officer, async () => { await decide(tx, second); });              // second on leave: exactly at the limit, allowed
      const third = await leaveFor(tx, w.t, w.members[2]!.m, w.vac, 'pending');
      await as(tx, w, w.officer, async () => {
        await expectDbError(tx, /leave limit.*Department cap/i, () => decide(tx, third));
      });
      expect((await tx`select status from leave_requests where id = ${third}`)[0]!.status).toBe('pending');
    });
  });

  it('reports other members on leave and the limit per day', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await limit(tx, w.t, { max: 2 });
      await leaveFor(tx, w.t, w.members[0]!.m, w.vac, 'approved');
      await leaveFor(tx, w.t, w.members[1]!.m, w.vac, 'approved');
      await as(tx, w, w.officer, async () => {
        const rows = await check(tx, w.members[2]!.m, w.vac);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ max_concurrent: 2, on_leave: 2, over: true });
        // A member already on leave is not counted against themselves.
        expect((await check(tx, w.members[0]!.m, w.vac))[0]).toMatchObject({ on_leave: 1, over: false });
      });
    });
  });

  it('pending, denied and cancelled requests do not count', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await limit(tx, w.t, { max: 1 });
      await leaveFor(tx, w.t, w.members[0]!.m, w.vac, 'pending');
      await leaveFor(tx, w.t, w.members[1]!.m, w.vac, 'denied');
      await leaveFor(tx, w.t, w.other.m, w.vac, 'cancelled');
      const mine = await leaveFor(tx, w.t, w.members[2]!.m, w.vac, 'pending');
      await as(tx, w, w.officer, async () => { await decide(tx, mine); });
    });
  });
});

describe('limit scoping', () => {
  it('an org-unit limit counts only that station', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await limit(tx, w.t, { unit: w.s1, max: 1, label: 'Station 1 cap' });
      await leaveFor(tx, w.t, w.other.m, w.vac, 'approved');                               // Station 2: not counted at Station 1
      await as(tx, w, w.officer, async () => {
        expect((await check(tx, w.members[0]!.m, w.vac))[0]).toMatchObject({ on_leave: 0, over: false });
        expect(await check(tx, w.other.m, w.vac)).toHaveLength(0);                         // Station 2 is not in that limit's scope
      });
      await leaveFor(tx, w.t, w.members[1]!.m, w.vac, 'approved');
      await as(tx, w, w.officer, async () => {
        expect((await check(tx, w.members[0]!.m, w.vac))[0]).toMatchObject({ on_leave: 1, over: true });
      });
    });
  });

  it('a shift-limited cap ignores members on another shift', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await limit(tx, w.t, { shift: w.shiftA, max: 0, label: 'A shift none' });
      await as(tx, w, w.officer, async () => {
        expect(await check(tx, w.members[0]!.m, w.vac)).toHaveLength(0);                   // these members are on shift B
        expect((await check(tx, w.other.m, w.vac))[0]).toMatchObject({ max_concurrent: 0, over: true });
      });
    });
  });

  it('a leave-type limit counts and applies to that type only', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await limit(tx, w.t, { type: w.vac, max: 1, label: 'Vacation cap' });
      await leaveFor(tx, w.t, w.members[0]!.m, w.sick, 'approved');                        // sick leave does not count toward the vacation cap
      await as(tx, w, w.officer, async () => {
        expect((await check(tx, w.members[1]!.m, w.vac))[0]).toMatchObject({ on_leave: 0, over: false });
        expect(await check(tx, w.members[1]!.m, w.sick)).toHaveLength(0);                  // and the cap does not apply to sick requests
      });
    });
  });

  it('respects the effective dates', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await limit(tx, w.t, { max: 0, effective: '[2020-01-01,2021-01-01)' });
      await limit(tx, w.t, { max: 0, effective: '[2090-01-01,)' });
      await as(tx, w, w.officer, async () => { expect(await check(tx, w.members[0]!.m, w.vac)).toHaveLength(0); });
    });
  });
});

describe('overriding a limit', () => {
  it('needs leave.manage and a reason; the reason is kept on the request', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await limit(tx, w.t, { max: 0, label: 'No leave' });
      const req = await leaveFor(tx, w.t, w.members[0]!.m, w.vac, 'pending');
      await as(tx, w, w.officer, async () => {
        await expectDbError(tx, /leave limit/i, () => decide(tx, req));
        await expectDbError(tx, /leave\.manage/i, () => decide(tx, req, null, 'Coverage arranged'));
      });
      await as(tx, w, w.manager, async () => {
        await expectDbError(tx, /at least 5 characters/i, () => decide(tx, req, null, 'no'));
        await decide(tx, req, null, 'Coverage arranged');
      });
      const [row] = await tx<{ status: string; decision_note: string }[]>`select status, decision_note from leave_requests where id = ${req}`;
      expect(row!.status).toBe('approved');
      expect(row!.decision_note).toContain('Limit override: Coverage arranged');
    });
  });

  it('an override reason is ignored when no limit is hit', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const req = await leaveFor(tx, w.t, w.members[0]!.m, w.vac, 'pending');
      await as(tx, w, w.officer, async () => { await decide(tx, req, null, 'not needed'); });
      expect((await tx`select decision_note from leave_requests where id = ${req}`)[0]!.decision_note).toBeNull();
    });
  });
});

describe('leave_limits table', () => {
  it('is readable by the department and writable only by department-wide leave.manage', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await limit(tx, w.t, { max: 3 });
      await as(tx, w, w.members[0]!, async () => {
        expect((await tx`select 1 from leave_limits`).length).toBe(1);
        await expectDbError(tx, /row-level security/, () => limit(tx, w.t, { max: 1 }));
      });
      await as(tx, w, w.manager, async () => { await limit(tx, w.t, { max: 4, label: 'Manager added' }); });
    });
  });

  it('is tenant isolated', async () => {
    await withAdmin(async (tx) => {
      await expectTenantIsolation(tx, 'leave_limits',
        async (t) => void (await limit(tx, t, { max: 1 })),
        (t) => limit(tx, t, { max: 1 }));
    });
  });

  it('validates scope shape and values', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await expectDbError(tx, /leave_limits_scope_check/, () =>
        tx`insert into leave_limits (tenant_id, label, scope_kind, max_concurrent, effective) values (${w.t}, 'x', 'org_unit', 1, '[2020-01-01,)')`);
      await expectDbError(tx, /leave_limits_max_concurrent_check/, () => limit(tx, w.t, { max: -1 }));
    });
  });
});

describe('leave_request_limits (approvals screen)', () => {
  it('lists days at or over a limit for a request the caller may decide, and refuses others', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await limit(tx, w.t, { max: 2, label: 'Cap two' });
      await leaveFor(tx, w.t, w.members[0]!.m, w.vac, 'approved');
      const second = await leaveFor(tx, w.t, w.members[1]!.m, w.vac, 'pending');
      await as(tx, w, w.officer, async () => {
        const rows = await tx<{ label: string; on_leave: number; over: boolean }[]>`select label, on_leave, over from app.leave_request_limits(${second})`;
        expect(rows).toEqual([{ label: 'Cap two', on_leave: 1, over: false }]);                 // at the limit, not over
        await expectDbError(tx, /not in your scope/, () => tx`select * from app.leave_request_limits(${crypto.randomUUID()})`);
      });
      await as(tx, w, w.members[2]!, async () => {
        await expectDbError(tx, /not in your scope/, () => tx`select * from app.leave_request_limits(${second})`);
      });
    });
  });
});
