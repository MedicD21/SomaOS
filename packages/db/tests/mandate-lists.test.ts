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

async function world(tx: Tx) {
  const t = await createTenant(tx);
  const s1 = await createOrgUnit(tx, t, 'Station 1');
  const s2 = await createOrgUnit(tx, t, 'Station 2');
  const seat1 = await createSeat(tx, t, s1, 'S1 seat');
  const seat2 = await createSeat(tx, t, s2, 'S2 seat');
  const captain = await person(tx, t, { perms: ['scheduling.mandate.manage', 'scheduling.roster.edit', 'scheduling.roster.view'] });
  // Holds the permission only through a station grant: list writes need it department-wide.
  const stationOnly = await person(tx, t, {
    perms: ['scheduling.mandate.manage', 'scheduling.roster.edit'],
    scope: { scopeKind: 'org_unit', orgUnitId: s1 },
  });
  // Department-wide mandate rights, roster edit only at station 2.
  const listKeeper = await person(tx, t, { perms: ['scheduling.mandate.manage'] });
  await grantRole(tx, t, listKeeper.m, await createRole(tx, t, `re_${listKeeper.m.slice(0, 6)}`, ['scheduling.roster.edit']), {
    scopeKind: 'org_unit',
    orgUnitId: s2,
  });
  const viewer = await person(tx, t, { perms: ['scheduling.roster.view'] });
  const nobody = await person(tx, t);
  const crew = [
    await createMember(tx, t, { first: 'Ann', last: 'Able' }),
    await createMember(tx, t, { first: 'Bo', last: 'Baker' }),
    await createMember(tx, t, { first: 'Cy', last: 'Cole' }),
  ];
  return { t, s1, s2, seat1, seat2, captain, stationOnly, listKeeper, viewer, nobody, crew };
}
type W = Awaited<ReturnType<typeof world>>;

const as = <T>(tx: Tx, w: { t: string }, who: { u: string }, fn: () => Promise<T>) => asUser(tx, { sub: who.u, tenant_id: w.t }, fn);
const one = async <T>(rows: Promise<T[]>) => (await rows)[0]!;

const createList = async (tx: Tx, name = 'A platoon ALS') =>
  (await one(tx<{ id: string }[]>`select app.create_mandate_list(${name}) as id`)).id;
const add = (tx: Tx, list: string, member: string) => tx`select app.mandate_add(${list}, ${member})`;
const order = async (tx: Tx, list: string) =>
  (await tx<{ member_id: string }[]>`
    select member_id from mandate_list_entries where list_id = ${list} and status = 'active' order by position`).map((r) => r.member_id);
const events = async (tx: Tx, list: string) =>
  (await tx<{ kind: string }[]>`select kind from mandate_events where list_id = ${list} order by created_at, id`).map((r) => r.kind);

/** A list with the three crew members in order, created by the captain. */
async function seeded(tx: Tx, w: W) {
  return as(tx, w, w.captain, async () => {
    const list = await createList(tx);
    for (const m of w.crew) await add(tx, list, m);
    return list;
  });
}

const record = (tx: Tx, list: string, member: string, seat: string, days = 10, override: string | null = null) =>
  tx<{ id: string }[]>`
    select app.mandate_record(${list}, ${member}, ${seat}, now() + make_interval(days => ${days}),
                              now() + make_interval(days => ${days}, hours => 24), ${'Below 25 ALS'}, ${override}) as id`;

describe('mandate list tables', () => {
  it('are isolated by tenant', async () => {
    await withAdmin(async (tx) => {
      const a = await world(tx);
      const b = await world(tx);
      const listA = await seeded(tx, a);
      const listB = await seeded(tx, b);
      await as(tx, a, a.captain, async () => {
        for (const table of ['mandate_lists', 'mandate_list_entries', 'mandate_events']) {
          const rows = await tx<{ tenant_id: string }[]>`select distinct tenant_id from ${tx(table)}`;
          expect(rows.map((r) => r.tenant_id)).toEqual([a.t]);
        }
        // Another department's list is unknown to the functions.
        await expectDbError(tx, /unknown mandate list/, () => add(tx, listB, b.crew[0]!));
        await expectDbError(tx, /unknown member/, () => add(tx, listA, b.crew[0]!));
      });
    });
  });

  it('have no direct writes for signed-in users', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const list = await seeded(tx, w);
      await as(tx, w, w.captain, async () => {
        await expectDbError(tx, /permission denied/, () => tx`update mandate_list_entries set position = 99 where list_id = ${list}`);
      });
      await as(tx, w, w.captain, async () => {
        await expectDbError(tx, /permission denied/, () => tx`delete from mandate_events where list_id = ${list}`);
      });
      await as(tx, w, w.captain, async () => {
        await expectDbError(tx, /permission denied/, () => tx`insert into mandate_lists (tenant_id, name) values (${w.t}, 'direct')`);
      });
    });
  });

  it('are readable by roster viewers only', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const list = await seeded(tx, w);
      await as(tx, w, w.viewer, async () => {
        expect(await order(tx, list)).toEqual(w.crew);
        expect(await events(tx, list)).toEqual(['added', 'added', 'added']);
      });
      await as(tx, w, w.nobody, async () => {
        expect(await order(tx, list)).toEqual([]);
        expect((await tx`select id from mandate_lists where id = ${list}`).length).toBe(0);
      });
    });
  });
});

describe('editing a mandate list', () => {
  it('needs department-wide scheduling.mandate.manage', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      for (const who of [w.stationOnly, w.viewer, w.nobody]) {
        await as(tx, w, who, async () => {
          await expectDbError(tx, /scheduling\.mandate\.manage/, () => createList(tx));
        });
      }
      const list = await seeded(tx, w);
      await as(tx, w, w.stationOnly, async () => {
        await expectDbError(tx, /scheduling\.mandate\.manage/, () =>
          tx`select app.mandate_reorder(${list}, ${[...w.crew].reverse()}::uuid[], 'New seniority list')`);
      });
    });
  });

  it('appends new members at the bottom and refuses duplicates and other departments', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const list = await seeded(tx, w);
      const other = await createMember(tx, await createTenant(tx));
      await as(tx, w, w.captain, async () => {
        expect(await order(tx, list)).toEqual(w.crew);
        await expectDbError(tx, /already on this list/, () => add(tx, list, w.crew[0]!));
        await expectDbError(tx, /unknown member/, () => add(tx, list, other));
      });
    });
  });

  it('reorders only with exactly the active members and a reason', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const list = await seeded(tx, w);
      const [a, b, c] = w.crew as [string, string, string];
      await as(tx, w, w.captain, async () => {
        await expectDbError(tx, /exactly the members/, () => tx`select app.mandate_reorder(${list}, ${[a, b]}::uuid[], 'Missing one member')`);
        await expectDbError(tx, /exactly the members/, () => tx`select app.mandate_reorder(${list}, ${[a, b, b]}::uuid[], 'Duplicate member')`);
        await expectDbError(tx, /exactly the members/, () =>
          tx`select app.mandate_reorder(${list}, ${[a, b, c, w.captain.m]}::uuid[], 'Extra member here')`);
        await expectDbError(tx, /at least 5 characters/, () => tx`select app.mandate_reorder(${list}, ${[c, a, b]}::uuid[], 'no')`);
        await tx`select app.mandate_reorder(${list}, ${[c, a, b]}::uuid[], 'Seniority list 2027')`;
        expect(await order(tx, list)).toEqual([c, a, b]);
        expect((await events(tx, list)).at(-1)).toBe('reordered');
      });
    });
  });

  it('exempts, skips and removes with a reason, keeping positions dense', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const list = await seeded(tx, w);
      const [a, b, c] = w.crew as [string, string, string];
      await as(tx, w, w.captain, async () => {
        await expectDbError(tx, /at least 5 characters/, () => tx`select app.mandate_set_exempt(${list}, ${a}, ${'x'}, null)`);
        await tx`select app.mandate_set_exempt(${list}, ${a}, ${'Light duty'}, ${'2027-02-01'})`;
        const [e] = await tx<{ exempt_reason: string; exempt_until: string }[]>`
          select exempt_reason, exempt_until::text from mandate_list_entries where list_id = ${list} and member_id = ${a} and status = 'active'`;
        expect(e).toEqual({ exempt_reason: 'Light duty', exempt_until: '2027-02-01' });
        await tx`select app.mandate_set_exempt(${list}, ${a}, null, null)`;

        await tx`select app.mandate_skip(${list}, ${b}, ${'Worked 36 h straight'}, ${'2027-01-05'})`;
        expect(await order(tx, list)).toEqual([a, b, c]);

        await expectDbError(tx, /at least 5 characters/, () => tx`select app.mandate_remove(${list}, ${b}, ${''})`);
        await tx`select app.mandate_remove(${list}, ${b}, ${'Promoted to Captain'})`;
        expect(await order(tx, list)).toEqual([a, c]);
        const positions = await tx<{ position: number }[]>`
          select position from mandate_list_entries where list_id = ${list} and status = 'active' order by position`;
        expect(positions.map((p) => p.position)).toEqual([1, 2]);
        // Re-adding after removal goes to the bottom.
        await add(tx, list, b);
        expect(await order(tx, list)).toEqual([a, c, b]);
        expect(await events(tx, list)).toEqual([
          'added', 'added', 'added', 'exempted', 'unexempted', 'skipped', 'removed', 'added',
        ]);
      });
    });
  });
});

describe('recording a mandate', () => {
  it('creates the overtime shift, rotates the member to the bottom and logs it', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const list = await seeded(tx, w);
      const [a, b, c] = w.crew as [string, string, string];
      await as(tx, w, w.captain, async () => {
        const { id } = await one(record(tx, list, a, w.seat1));
        const [asg] = await tx<{ member_id: string; seat_id: string; type: string; status: string }[]>`
          select member_id, seat_id, type, status from shift_assignments where id = ${id}`;
        expect(asg).toEqual({ member_id: a, seat_id: w.seat1, type: 'overtime', status: 'scheduled' });
        expect(await order(tx, list)).toEqual([b, c, a]);
        const [ev] = await tx<{ kind: string; assignment_id: string; reason: string }[]>`
          select kind, assignment_id, reason from mandate_events where list_id = ${list} and kind = 'mandated'`;
        expect(ev).toEqual({ kind: 'mandated', assignment_id: id, reason: 'Below 25 ALS' });
      });
    });
  });

  it('needs roster edit at the seat’s unit', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const list = await seeded(tx, w);
      await as(tx, w, w.listKeeper, async () => {
        await expectDbError(tx, /not in your scope/, () => record(tx, list, w.crew[0]!, w.seat1));
      });
      await as(tx, w, w.listKeeper, async () => {
        const { id } = await one(record(tx, list, w.crew[0]!, w.seat2));
        expect(id).toBeTruthy();
      });
    });
  });

  it('refuses a double-booked member or seat and leaves the list unchanged', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const list = await seeded(tx, w);
      const [a, b] = w.crew as [string, string, string];
      await tx`
        insert into shift_assignments (tenant_id, member_id, seat_id, during, type, source)
        values (${w.t}, ${a}, ${w.seat2}, tstzrange(now() + interval '10 days', now() + interval '11 days'), 'regular', 'manual')`;
      await as(tx, w, w.captain, async () => {
        await expectDbError(tx, /already scheduled/, () => record(tx, list, a, w.seat1));
      });
      await as(tx, w, w.captain, async () => {
        await expectDbError(tx, /already filled/, () => record(tx, list, b, w.seat2));
      });
      await as(tx, w, w.captain, async () => {
        expect(await order(tx, list)).toEqual(w.crew);
        expect(await events(tx, list)).not.toContain('mandated');
      });
    });
  });

  it('refuses members not on the list, past times and overrides without the permission', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const list = await seeded(tx, w);
      await as(tx, w, w.captain, async () => {
        await expectDbError(tx, /not on this list/, () => record(tx, list, w.viewer.m, w.seat1));
        await expectDbError(tx, /upcoming/, () => record(tx, list, w.crew[0]!, w.seat1, -3));
        await expectDbError(tx, /qualification override/, () => record(tx, list, w.crew[0]!, w.seat1, 10, 'No medic available'));
      });
    });
  });
});
