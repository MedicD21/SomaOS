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

async function shift(tx: Tx, t: string, member: string, seat: string, days: number, type = 'regular') {
  const [r] = await tx<{ id: string }[]>`
    insert into shift_assignments (tenant_id, member_id, seat_id, during, type, source)
    values (${t}, ${member}, ${seat}, tstzrange(now() + make_interval(days => ${days}), now() + make_interval(days => ${days}, hours => 24)), ${type}, 'manual')
    returning id`;
  return r!.id;
}

async function world(tx: Tx) {
  const t = await createTenant(tx);
  const s1 = await createOrgUnit(tx, t, 'Station 1');
  const s2 = await createOrgUnit(tx, t, 'Station 2');
  const seat1 = await createSeat(tx, t, s1, 'S1 seat');
  const otherSeat = await createSeat(tx, t, s2, 'S2 seat');
  const a = await person(tx, t, { perms: ['scheduling.openshift.claim'] });
  const b = await person(tx, t, { perms: ['scheduling.openshift.claim'] });
  const noPerm = await person(tx, t);
  const officer1 = await person(tx, t, { perms: ['scheduling.roster.edit'], scope: { scopeKind: 'org_unit', orgUnitId: s1 } });
  const officer2 = await person(tx, t, { perms: ['scheduling.roster.edit'], scope: { scopeKind: 'org_unit', orgUnitId: s2 } });
  const override = await person(tx, t, { perms: ['scheduling.roster.edit', 'scheduling.qualification.override'] });
  // An officer who may also claim, to prove nobody decides their own claim.
  const selfOfficer = await person(tx, t, { perms: ['scheduling.roster.edit', 'scheduling.openshift.claim'] });
  return { t, seat1, otherSeat, a, b, noPerm, officer1, officer2, override, selfOfficer };
}
type W = Awaited<ReturnType<typeof world>>;

const as = <T>(tx: Tx, w: { t: string }, who: { u: string }, fn: () => Promise<T>) => asUser(tx, { sub: who.u, tenant_id: w.t }, fn);
const post = async (tx: Tx, w: W, days = 15, type = 'overtime', reason = 'Short for the weekend') =>
  (await tx<{ id: string }[]>`select app.post_open_shift(${w.seat1}, now() + make_interval(days => ${days}), now() + make_interval(days => ${days}, hours => 24), ${type}, ${reason}) as id`)[0]!.id;
const claim = async (tx: Tx, id: string, note: string | null = null) =>
  (await tx<{ id: string }[]>`select app.claim_open_shift(${id}, ${note}) as id`)[0]!.id;

describe('posting an open shift', () => {
  it('needs roster edit at the seat’s unit, a future time, a real type and reason', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      for (const who of [w.noPerm, w.a, w.officer2]) {
        await as(tx, w, who, async () => {
          await expectDbError(tx, /not in your scope/, () => post(tx, w));
        });
      }
      await as(tx, w, w.officer1, async () => {
        await expectDbError(tx, /upcoming/, () => post(tx, w, -2));
        await expectDbError(tx, /work type/, () => post(tx, w, 15, 'detail'));
        await expectDbError(tx, /at least 5 characters/, () => post(tx, w, 15, 'overtime', 'no'));
        const id = await post(tx, w);
        expect(id).toBeTruthy();
        await expectDbError(tx, /already posted/, () => post(tx, w));
      });
    });
  });

  it('is refused when the seat is already filled for that time', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await shift(tx, w.t, w.b.m, w.seat1, 15);
      await as(tx, w, w.officer1, async () => {
        await expectDbError(tx, /already filled/, () => post(tx, w));
      });
    });
  });

  it('can be cancelled by the unit’s officers, which withdraws pending claims', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let open = '';
      await as(tx, w, w.officer1, async () => { open = await post(tx, w); });
      await as(tx, w, w.a, async () => { await claim(tx, open); });
      await as(tx, w, w.officer2, async () => {
        await expectDbError(tx, /not in your scope/, () => tx`select app.cancel_open_shift(${open}, 'Not needed any more')`);
      });
      await as(tx, w, w.officer1, async () => {
        await expectDbError(tx, /at least 5 characters/, () => tx`select app.cancel_open_shift(${open}, 'no')`);
        await tx`select app.cancel_open_shift(${open}, 'Not needed any more')`;
        await expectDbError(tx, /no longer open/, () => tx`select app.cancel_open_shift(${open}, 'Not needed any more')`);
      });
      expect((await tx`select status from open_shift_claims`)[0]!.status).toBe('withdrawn');
      await as(tx, w, w.b, async () => {
        await expectDbError(tx, /no longer open/, () => claim(tx, open));
      });
    });
  });
});

describe('claiming', () => {
  it('needs the claim permission, an open future shift, and no overlap with your own shifts', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let open = '';
      await as(tx, w, w.officer1, async () => { open = await post(tx, w); });
      await as(tx, w, w.noPerm, async () => {
        await expectDbError(tx, /scheduling\.openshift\.claim required/, () => claim(tx, open));
      });
      // A shift overlapping the open shift's time (different seat) blocks the claim.
      await shift(tx, w.t, w.a.m, w.otherSeat, 15);
      await as(tx, w, w.a, async () => {
        await expectDbError(tx, /already scheduled/, () => claim(tx, open));
      });
      await as(tx, w, w.b, async () => {
        await claim(tx, open, 'I can work it');
        await expectDbError(tx, /already have a claim/, () => claim(tx, open));
      });
    });
  });

  it('can be withdrawn only by the claimant, once', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let open = '';
      let c = '';
      await as(tx, w, w.officer1, async () => { open = await post(tx, w); });
      await as(tx, w, w.a, async () => { c = await claim(tx, open); });
      await as(tx, w, w.b, async () => {
        await expectDbError(tx, /only the member who claimed/, () => tx`select app.withdraw_claim(${c})`);
      });
      await as(tx, w, w.a, async () => {
        await tx`select app.withdraw_claim(${c})`;
        await expectDbError(tx, /already decided/, () => tx`select app.withdraw_claim(${c})`);
        // Free to claim again after withdrawing.
        await claim(tx, open);
      });
    });
  });
});

describe('deciding a claim', () => {
  async function twoClaims(tx: Tx) {
    const w = await world(tx);
    let open = '';
    let ca = '';
    let cb = '';
    await as(tx, w, w.officer1, async () => { open = await post(tx, w); });
    await as(tx, w, w.a, async () => { ca = await claim(tx, open); });
    await as(tx, w, w.b, async () => { cb = await claim(tx, open); });
    return { ...w, open, ca, cb };
  }

  it('approval creates the assignment, fills the shift and supersedes the other claims', async () => {
    await withAdmin(async (tx) => {
      const w = await twoClaims(tx);
      await as(tx, w, w.officer1, async () => { await tx`select app.decide_claim(${w.ca}, true, 'Thanks', null, false)`; });
      const [asg] = await tx<{ member_id: string; type: string; status: string; source: string }[]>`
        select member_id, type, status, source from shift_assignments where seat_id = ${w.seat1} and status = 'scheduled'`;
      expect(asg).toEqual({ member_id: w.a.m, type: 'overtime', status: 'scheduled', source: 'manual' });
      const claims = await tx<{ id: string; status: string }[]>`select id, status from open_shift_claims`;
      expect(claims.find((c) => c.id === w.ca)!.status).toBe('approved');
      expect(claims.find((c) => c.id === w.cb)!.status).toBe('superseded');
      const [o] = await tx<{ status: string; filled_assignment_id: string | null }[]>`select status, filled_assignment_id from open_shifts where id = ${w.open}`;
      expect(o!.status).toBe('filled');
      expect(o!.filled_assignment_id).not.toBeNull();
      for (const m of [w.a.m, w.b.m]) expect((await tx`select 1 from notifications where member_id = ${m} and kind = 'open_shift'`).length).toBeGreaterThan(0);
      await as(tx, w, w.officer1, async () => {
        await expectDbError(tx, /no longer pending/, () => tx`select app.decide_claim(${w.cb}, true, null, null, false)`);
      });
    });
  });

  it('is limited to officers at the seat’s unit, and nobody decides their own claim', async () => {
    await withAdmin(async (tx) => {
      const w = await twoClaims(tx);
      for (const who of [w.officer2, w.noPerm, w.a]) {
        await as(tx, w, who, async () => {
          await expectDbError(tx, /not in your scope/, () => tx`select app.decide_claim(${w.ca}, true, null, null, false)`);
        });
      }
      let mine = '';
      await as(tx, w, w.selfOfficer, async () => { mine = await claim(tx, w.open); });
      await as(tx, w, w.selfOfficer, async () => {
        await expectDbError(tx, /not in your scope/, () => tx`select app.decide_claim(${mine}, true, null, null, false)`);
      });
    });
  });

  it('denying leaves the shift open for the other claims', async () => {
    await withAdmin(async (tx) => {
      const w = await twoClaims(tx);
      await as(tx, w, w.officer1, async () => {
        await tx`select app.decide_claim(${w.ca}, false, 'Prefer someone closer', null, false)`;
      });
      expect((await tx`select status from open_shifts where id = ${w.open}`)[0]!.status).toBe('open');
      expect((await tx`select status from open_shift_claims where id = ${w.ca}`)[0]!.status).toBe('denied');
      await as(tx, w, w.officer1, async () => {
        await tx`select app.decide_claim(${w.cb}, true, null, null, false)`;
      });
      expect((await tx`select status from open_shifts where id = ${w.open}`)[0]!.status).toBe('filled');
    });
  });

  it('is refused by the database when the claimant was double-booked in the meantime, and nothing changes', async () => {
    await withAdmin(async (tx) => {
      const w = await twoClaims(tx);
      await shift(tx, w.t, w.a.m, w.otherSeat, 15);
      await as(tx, w, w.officer1, async () => {
        await expectDbError(tx, /member_no_overlap/, () => tx`select app.decide_claim(${w.ca}, true, null, null, false)`);
      });
      expect((await tx`select status from open_shifts where id = ${w.open}`)[0]!.status).toBe('open');
      expect((await tx`select 1 from shift_assignments where seat_id = ${w.seat1}`).length).toBe(0);
    });
  });

  it('is refused when the seat was filled another way', async () => {
    await withAdmin(async (tx) => {
      const w = await twoClaims(tx);
      await shift(tx, w.t, w.noPerm.m, w.seat1, 15);
      await as(tx, w, w.officer1, async () => {
        await expectDbError(tx, /seat_no_overlap/, () => tx`select app.decide_claim(${w.ca}, true, null, null, false)`);
      });
    });
  });

  it('a qualification override needs its own permission and a reason, and is recorded', async () => {
    await withAdmin(async (tx) => {
      const w = await twoClaims(tx);
      await as(tx, w, w.officer1, async () => {
        await expectDbError(tx, /overriding needs qualification override/, () => tx`select app.decide_claim(${w.ca}, true, null, 'Short staffed', false)`);
      });
      await as(tx, w, w.override, async () => {
        await expectDbError(tx, /at least 5 characters/, () => tx`select app.decide_claim(${w.ca}, true, null, 'no', false)`);
        await tx`select app.decide_claim(${w.ca}, true, null, 'Short staffed', true)`;
      });
      const [asg] = await tx<{ override_reason: string; acting: boolean }[]>`select override_reason, acting from shift_assignments where seat_id = ${w.seat1}`;
      expect(asg).toEqual({ override_reason: 'Short staffed', acting: true });
    });
  });
});

describe('who can see open shifts', () => {
  it('claimants and officers of the unit; no direct writes; tenant isolated', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let open = '';
      await as(tx, w, w.officer1, async () => { open = await post(tx, w); });
      await as(tx, w, w.a, async () => { await claim(tx, open); });
      const shifts = (who: { u: string }) => as(tx, w, who, async () => (await tx`select 1 from open_shifts`).length);
      const claims = (who: { u: string }) => as(tx, w, who, async () => (await tx`select 1 from open_shift_claims`).length);
      expect(await shifts(w.a)).toBe(1);
      expect(await shifts(w.officer1)).toBe(1);
      expect(await shifts(w.noPerm)).toBe(0);
      expect(await shifts(w.officer2)).toBe(0);
      expect(await claims(w.a)).toBe(1); // own claim
      expect(await claims(w.b)).toBe(0); // someone else's claim
      expect(await claims(w.officer1)).toBe(1);
      expect(await claims(w.officer2)).toBe(0);
      await as(tx, w, w.officer1, async () => {
        await expectDbError(tx, /permission denied/, () => tx`update open_shifts set status = 'filled'`);
        await expectDbError(tx, /permission denied/, () => tx`delete from open_shift_claims`);
      });
      const other = await world(tx);
      expect(await as(tx, other, other.officer1, async () => (await tx`select 1 from open_shifts`).length)).toBe(0);
    });
  });
});
