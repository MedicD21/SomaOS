import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { createMember, createOrgUnit, createRole, createSeat, createTenant, grantRole, userInTenant } from './helpers';

afterAll(closeTestDb);

async function person(tx: Tx, t: string, opts: { perms?: string[]; scope?: Parameters<typeof grantRole>[4] } = {}) {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u });
  if (opts.perms?.length) await grantRole(tx, t, m, await createRole(tx, t, `r_${m.slice(0, 6)}`, opts.perms), opts.scope);
  return { u, m };
}

/** A 24 h assignment starting `days` days from now. */
async function shift(tx: Tx, t: string, member: string, seat: string | null, days: number, type = 'regular', status = 'scheduled') {
  const [r] = await tx<{ id: string }[]>`
    insert into shift_assignments (tenant_id, member_id, seat_id, during, type, source, status)
    values (${t}, ${member}, ${seat}, tstzrange(now() + make_interval(days => ${days}), now() + make_interval(days => ${days}, hours => 24)),
            ${type}, 'manual', ${status}) returning id`;
  return r!.id;
}

async function world(tx: Tx) {
  const t = await createTenant(tx);
  const s1 = await createOrgUnit(tx, t, 'Station 1');
  const s2 = await createOrgUnit(tx, t, 'Station 2');
  const seat1 = await createSeat(tx, t, s1, 'S1 seat');
  const seat2 = await createSeat(tx, t, s2, 'S2 seat');
  const a = await person(tx, t, { perms: ['scheduling.trade.request'] });
  const b = await person(tx, t, { perms: ['scheduling.trade.request'] });
  const noPerm = await person(tx, t);
  const both = await person(tx, t, { perms: ['scheduling.roster.edit'] });                                       // department
  const only1 = await person(tx, t, { perms: ['scheduling.roster.edit'], scope: { scopeKind: 'org_unit', orgUnitId: s1 } });
  const nowhere = await person(tx, t, { perms: ['scheduling.roster.edit'], scope: { scopeKind: 'org_unit', orgUnitId: await createOrgUnit(tx, t, 'Station 3') } });
  const override = await person(tx, t, { perms: ['scheduling.roster.edit', 'scheduling.qualification.override'] });
  const mine = await shift(tx, t, a.m, seat1, 10);
  const theirs = await shift(tx, t, b.m, seat2, 12);
  return { t, seat1, seat2, a, b, noPerm, both, only1, nowhere, override, mine, theirs };
}

const as = <T>(tx: Tx, w: { t: string }, who: { u: string }, fn: () => Promise<T>) => asUser(tx, { sub: who.u, tenant_id: w.t }, fn);
const propose = async (tx: Tx, w: Awaited<ReturnType<typeof world>>, note: string | null = null) =>
  (await tx<{ id: string }[]>`select app.request_trade(${w.mine}, ${w.theirs}, ${note}) as id`)[0]!.id;
const owner = async (tx: Tx, id: string) => (await tx<{ member_id: string; type: string; status: string }[]>`select member_id, type, status from shift_assignments where id = ${id}`)[0]!;

describe('proposing a trade', () => {
  it('needs the permission and two upcoming, scheduled, seated shifts owned as described', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.noPerm, async () => {
        await expectDbError(tx, /scheduling\.trade\.request required/, () => propose(tx, w));
      });
      await as(tx, w, w.a, async () => {
        await expectDbError(tx, /not one of your shifts/, () => tx`select app.request_trade(${w.theirs}, ${w.mine}, null)`);
        const own2 = await (async () => { await tx`reset role`; const id = await shift(tx, w.t, w.a.m, w.seat1, 20); await tx`set local role authenticated`; return id; })();
        await expectDbError(tx, /someone else/, () => tx`select app.request_trade(${w.mine}, ${own2}, null)`);
      });
      // Past, kelly, cancelled, seatless.
      const past = await shift(tx, w.t, w.b.m, w.seat2, -3);
      const kelly = await shift(tx, w.t, w.b.m, null, 30, 'kelly');
      const cancelled = await shift(tx, w.t, w.b.m, w.seat2, 40, 'regular', 'cancelled');
      const seatless = await shift(tx, w.t, w.b.m, null, 50, 'training');
      await as(tx, w, w.a, async () => {
        for (const bad of [past, kelly, cancelled, seatless]) {
          await expectDbError(tx, /upcoming scheduled shifts with a seat/, () => tx`select app.request_trade(${w.mine}, ${bad}, null)`);
        }
      });
    });
  });

  it('allows one open trade per shift and notifies the counterparty', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.a, async () => {
        await propose(tx, w, 'Wedding that weekend');
        await expectDbError(tx, /already in a pending trade/, () => propose(tx, w));
      });
      const n = await tx`select 1 from notifications where member_id = ${w.b.m} and kind = 'trade'`;
      expect(n.length).toBe(1);
    });
  });
});

describe('answering and withdrawing', () => {
  it('only the counterparty answers; either party can withdraw until it is decided', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let id = '';
      await as(tx, w, w.a, async () => { id = await propose(tx, w); });
      await as(tx, w, w.a, async () => {
        await expectDbError(tx, /only the member asked/, () => tx`select app.respond_trade(${id}, true)`);
      });
      await as(tx, w, w.noPerm, async () => {
        await expectDbError(tx, /only the member asked/, () => tx`select app.respond_trade(${id}, true)`);
        await expectDbError(tx, /only the members in this trade/, () => tx`select app.cancel_trade(${id})`);
      });
      await as(tx, w, w.b, async () => {
        await tx`select app.respond_trade(${id}, true)`;
        await expectDbError(tx, /no longer waiting for your answer/, () => tx`select app.respond_trade(${id}, false)`);
        await tx`select app.cancel_trade(${id})`;
        await expectDbError(tx, /already decided/, () => tx`select app.cancel_trade(${id})`);
      });
      // A declined trade frees the shifts for a new proposal.
      let again = '';
      await as(tx, w, w.a, async () => { again = await propose(tx, w); });
      await as(tx, w, w.b, async () => { await tx`select app.respond_trade(${again}, false)`; });
      await as(tx, w, w.a, async () => { await propose(tx, w); });
    });
  });
});

describe('deciding a trade', () => {
  async function accepted(tx: Tx) {
    const w = await world(tx);
    let id = '';
    await as(tx, w, w.a, async () => { id = await propose(tx, w); });
    await as(tx, w, w.b, async () => { await tx`select app.respond_trade(${id}, true)`; });
    return { ...w, id };
  }

  it('swaps both shifts, marks them as trades, and tells both members', async () => {
    await withAdmin(async (tx) => {
      const w = await accepted(tx);
      await as(tx, w, w.both, async () => { await tx`select app.decide_trade(${w.id}, true, 'Looks fine', null)`; });
      expect(await owner(tx, w.mine)).toEqual({ member_id: w.b.m, type: 'trade', status: 'scheduled' });
      expect(await owner(tx, w.theirs)).toEqual({ member_id: w.a.m, type: 'trade', status: 'scheduled' });
      const [t] = await tx<{ status: string; decision_note: string }[]>`select status, decision_note from shift_trades where id = ${w.id}`;
      expect(t).toEqual({ status: 'approved', decision_note: 'Looks fine' });
      for (const m of [w.a.m, w.b.m]) {
        expect((await tx`select 1 from notifications where member_id = ${m} and title = 'Trade approved'`).length).toBe(1);
      }
    });
  });

  it('swaps two shifts at the same time (members trade stations) without a false double-booking', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await tx`update shift_assignments set during = (select during from shift_assignments where id = ${w.mine}) where id = ${w.theirs}`;
      let id = '';
      await as(tx, w, w.a, async () => { id = await propose(tx, w); });
      await as(tx, w, w.b, async () => { await tx`select app.respond_trade(${id}, true)`; });
      await as(tx, w, w.both, async () => { await tx`select app.decide_trade(${id}, true, null, null)`; });
      expect((await owner(tx, w.mine)).member_id).toBe(w.b.m);
      expect((await owner(tx, w.theirs)).member_id).toBe(w.a.m);
    });
  });

  it('needs roster edit at BOTH stations and never lets a party decide', async () => {
    await withAdmin(async (tx) => {
      const w = await accepted(tx);
      for (const who of [w.only1, w.nowhere, w.noPerm]) {
        await as(tx, w, who, async () => {
          await expectDbError(tx, /not in your scope/, () => tx`select app.decide_trade(${w.id}, true, null, null)`);
        });
      }
      // A party with department roster edit is still a party.
      const partyOfficer = await person(tx, w.t, { perms: ['scheduling.trade.request', 'scheduling.roster.edit'] });
      const own = await shift(tx, w.t, partyOfficer.m, w.seat1, 60);
      const other = await shift(tx, w.t, w.b.m, w.seat2, 61);
      let id = '';
      await as(tx, w, partyOfficer, async () => { id = (await tx<{ id: string }[]>`select app.request_trade(${own}, ${other}, null) as id`)[0]!.id; });
      await as(tx, w, w.b, async () => { await tx`select app.respond_trade(${id}, true)`; });
      await as(tx, w, partyOfficer, async () => {
        await expectDbError(tx, /not in your scope/, () => tx`select app.decide_trade(${id}, true, null, null)`);
      });
      expect((await owner(tx, w.mine)).member_id).toBe(w.a.m);
    });
  });

  it('denying changes nothing on the roster', async () => {
    await withAdmin(async (tx) => {
      const w = await accepted(tx);
      await as(tx, w, w.both, async () => { await tx`select app.decide_trade(${w.id}, false, 'Short staffed that day', null)`; });
      expect((await owner(tx, w.mine)).member_id).toBe(w.a.m);
      expect((await tx`select status from shift_trades where id = ${w.id}`)[0]!.status).toBe('denied');
    });
  });

  it('is refused when a shift changed after the proposal', async () => {
    await withAdmin(async (tx) => {
      const w = await accepted(tx);
      await tx`update shift_assignments set status = 'cancelled', cancelled_reason = 'Moved elsewhere' where id = ${w.theirs}`;
      await as(tx, w, w.both, async () => {
        await expectDbError(tx, /no longer valid/, () => tx`select app.decide_trade(${w.id}, true, null, null)`);
      });
      expect((await owner(tx, w.mine)).member_id).toBe(w.a.m);
    });
  });

  it('is refused by the database when it would double-book a member, and nothing moves', async () => {
    await withAdmin(async (tx) => {
      const w = await accepted(tx);
      // B already works at the time of A's shift (at S2... a different seat), so B cannot take it.
      await shift(tx, w.t, w.b.m, w.seat2, 10);
      await as(tx, w, w.both, async () => {
        await expectDbError(tx, /member_no_overlap/, () => tx`select app.decide_trade(${w.id}, true, null, null)`);
      });
      expect((await owner(tx, w.mine)).member_id).toBe(w.a.m);
      expect((await owner(tx, w.theirs)).member_id).toBe(w.b.m);
    });
  });

  it('a qualification override needs its own permission at both stations, and a reason', async () => {
    await withAdmin(async (tx) => {
      const w = await accepted(tx);
      await as(tx, w, w.both, async () => {
        await expectDbError(tx, /overriding needs qualification override/, () => tx`select app.decide_trade(${w.id}, true, null, 'Short staffed')`);
      });
      await as(tx, w, w.override, async () => {
        await expectDbError(tx, /at least 5 characters/, () => tx`select app.decide_trade(${w.id}, true, null, 'no')`);
        await tx`select app.decide_trade(${w.id}, true, null, 'Short staffed')`;
      });
      expect((await tx`select override_reason from shift_assignments where id = ${w.mine}`)[0]!.override_reason).toBe('Short staffed');
      expect((await tx`select override_reason from shift_trades where id = ${w.id}`)[0]!.override_reason).toBe('Short staffed');
    });
  });

  it('cannot be decided twice or before the counterparty accepts', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let id = '';
      await as(tx, w, w.a, async () => { id = await propose(tx, w); });
      await as(tx, w, w.both, async () => {
        await expectDbError(tx, /not waiting for approval/, () => tx`select app.decide_trade(${id}, true, null, null)`);
      });
      await as(tx, w, w.b, async () => { await tx`select app.respond_trade(${id}, true)`; });
      await as(tx, w, w.both, async () => {
        await tx`select app.decide_trade(${id}, true, null, null)`;
        await expectDbError(tx, /not waiting for approval/, () => tx`select app.decide_trade(${id}, true, null, null)`);
      });
    });
  });
});

describe('who can see trades', () => {
  it('the two members, officers of either station, nobody else; no direct writes; tenant isolated', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.a, async () => { await propose(tx, w); });
      const count = (who: { u: string }) => as(tx, w, who, async () => (await tx`select 1 from shift_trades`).length);
      expect(await count(w.a)).toBe(1);
      expect(await count(w.b)).toBe(1);
      expect(await count(w.both)).toBe(1);
      expect(await count(w.only1)).toBe(1);
      expect(await count(w.nowhere)).toBe(0);
      expect(await count(w.noPerm)).toBe(0);
      await as(tx, w, w.both, async () => {
        await expectDbError(tx, /permission denied/, () => tx`update shift_trades set status = 'approved'`);
        await expectDbError(tx, /permission denied/, () => tx`delete from shift_trades`);
      });
      const other = await world(tx);
      expect(await as(tx, other, other.both, async () => (await tx`select 1 from shift_trades`).length)).toBe(0);
    });
  });
});
