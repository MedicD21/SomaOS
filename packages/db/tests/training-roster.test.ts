import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { createMember, createOrgUnit, createRole, createSeat, createTenant, grantRole, userInTenant } from './helpers';

afterAll(closeTestDb);

type Who = { u: string; m: string };

async function person(tx: Tx, t: string, opts: { perms?: string[]; scope?: Parameters<typeof grantRole>[4] } = {}): Promise<Who> {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u });
  if (opts.perms?.length) await grantRole(tx, t, m, await createRole(tx, t, `r_${m.slice(0, 6)}`, opts.perms), opts.scope);
  return { u, m };
}

async function assign(tx: Tx, t: string, member: string, unit: string) {
  await tx`insert into member_assignments (tenant_id, member_id, org_unit_id, effective) values (${t}, ${member}, ${unit}, '[2020-01-01,)')`;
}

async function world(tx: Tx) {
  const t = await createTenant(tx);
  const s1 = await createOrgUnit(tx, t, 'Station 1');
  const s2 = await createOrgUnit(tx, t, 'Station 2');
  const seat1 = await createSeat(tx, t, s1, 'S1 seat');
  const [category] = await tx<{ id: string }[]>`insert into training_categories (tenant_id, key, label) values (${t}, 'fire', 'Fire') returning id`;
  const [course] = await tx<{ id: string }[]>`insert into training_courses (tenant_id, key, label, category_id, default_hours) values (${t}, 'drill', 'Drill', ${category!.id}, 2) returning id`;
  const mgr = await person(tx, t, { perms: ['training.session.manage', 'scheduling.roster.edit', 'training.compliance.view', 'training.attendance.manage'] });
  const noRoster = await person(tx, t, { perms: ['training.session.manage'] });
  const officer1 = await person(tx, t, { perms: ['training.compliance.view', 'training.session.manage', 'training.attendance.mark'], scope: { scopeKind: 'org_unit', orgUnitId: s1 } });
  const a = await person(tx, t);   // station 1
  const b = await person(tx, t);   // station 1
  const c = await person(tx, t);   // station 2
  await assign(tx, t, a.m, s1);
  await assign(tx, t, b.m, s1);
  await assign(tx, t, c.m, s2);
  return { t, s1, s2, seat1, category: category!.id, course: course!.id, mgr, noRoster, officer1, a, b, c };
}
type W = Awaited<ReturnType<typeof world>>;

const as = <T>(tx: Tx, w: { t: string }, who: { u: string }, fn: () => Promise<T>) => asUser(tx, { sub: who.u, tenant_id: w.t }, fn);

/** A scheduled session starting in `days` days that lasts two hours, with these members enrolled. */
async function futureSession(tx: Tx, w: W, members: Who[], days = 2): Promise<string> {
  const start = new Date(Date.now() + days * 86_400_000);
  const end = new Date(start.getTime() + 2 * 3_600_000);
  const id = (await tx<{ id: string }[]>`
    select app.create_training_session(${w.course}, 'Engine drill', ${start.toISOString()}, ${end.toISOString()}, null, null, null, null, false, 2, null,
      ${tx.json(members.map((m) => ({ kind: 'member', ref_id: m.m })) as never)}) as id`)[0]!.id;
  await tx`select app.publish_training_session(${id})`;
  return id;
}
const schedule = (tx: Tx, session: string, members: Who[]) =>
  tx<{ r: { created: string[]; skipped: { member_id: string; reason: string }[] } }[]>`
    select app.schedule_training_assignments(${session}, ${members.map((m) => m.m)}::uuid[]) as r`.then((rows) => rows[0]!.r);

describe('putting a session on the roster', () => {
  it('creates seatless training assignments for the session time and links them', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.mgr, async () => {
        const id = await futureSession(tx, w, [w.a, w.b]);
        const r = await schedule(tx, id, [w.a, w.b]);
        expect(r.created).toHaveLength(2);
        expect(r.skipped).toEqual([]);
        const rows = await tx<{ type: string; seat_id: string | null; source: string; explain: { rule: string }[]; member_id: string }[]>`
          select a.type, a.seat_id, a.source, a.explain, a.member_id from shift_assignments a
          join training_session_assignments l on l.assignment_id = a.id where l.session_id = ${id}`;
        expect(rows).toHaveLength(2);
        for (const row of rows) {
          expect(row).toMatchObject({ type: 'training', seat_id: null, source: 'manual' });
          expect(row.explain[0]!.rule).toBe('training.session');
        }
        // Doing it again does not duplicate.
        const again = await schedule(tx, id, [w.a]);
        expect(again.created).toEqual([]);
        expect(again.skipped[0]!.reason).toMatch(/Already on the roster/);
      });
    });
  });

  it('skips a member who is already working, leaves their shift intact, and ignores kelly days', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let id = '';
      await as(tx, w, w.mgr, async () => {
        id = await futureSession(tx, w, [w.a, w.b, w.c]);
      });
      const [session] = await tx<{ starts_at: Date; ends_at: Date }[]>`select starts_at, ends_at from training_sessions where id = ${id}`;
      // a works a regular shift across the session; b has a kelly day over it; c is free.
      const [shift] = await tx<{ id: string }[]>`
        insert into shift_assignments (tenant_id, member_id, seat_id, during, type, source)
        values (${w.t}, ${w.a.m}, ${w.seat1}, tstzrange(${new Date(session!.starts_at.getTime() - 3_600_000).toISOString()}, ${new Date(session!.ends_at.getTime() + 3_600_000).toISOString()}), 'regular', 'manual') returning id`;
      await tx`insert into shift_assignments (tenant_id, member_id, seat_id, during, type, source)
               values (${w.t}, ${w.b.m}, null, tstzrange(${session!.starts_at.toISOString()}, ${session!.ends_at.toISOString()}), 'kelly', 'generated')`;
      await as(tx, w, w.mgr, async () => {
        const r = await schedule(tx, id, [w.a, w.b, w.c]);
        expect(r.created).toHaveLength(2);
        expect(r.skipped).toEqual([{ member_id: w.a.m, reason: 'Already scheduled during that time' }]);
      });
      const kept = await tx<{ status: string; type: string }[]>`select status, type from shift_assignments where id = ${shift!.id}`;
      expect(kept).toEqual([{ status: 'scheduled', type: 'regular' }]);
    });
  });

  it('needs scheduling.roster.edit as well as session management, and only for enrolled members', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let id = '';
      await as(tx, w, w.mgr, async () => {
        id = await futureSession(tx, w, [w.a]);
      });
      await as(tx, w, w.noRoster, async () => {
        await expectDbError(tx, /scheduling\.roster\.edit required/, () => schedule(tx, id, [w.a]));
      });
      await as(tx, w, w.officer1, async () => {
        await expectDbError(tx, /cannot manage training at this unit/, () => schedule(tx, id, [w.a]));
      });
      await as(tx, w, w.mgr, async () => {
        const r = await schedule(tx, id, [w.b]);   // b is not enrolled
        expect(r.created).toEqual([]);
        expect(r.skipped[0]!.reason).toMatch(/Not enrolled/);
      });
    });
  });
});

describe('cancel and withdraw cascade to the roster', () => {
  it('cancelling the session cancels only its own scheduled training rows', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let id = '';
      let other = '';
      await as(tx, w, w.mgr, async () => {
        id = await futureSession(tx, w, [w.a, w.b]);
        other = await futureSession(tx, w, [w.a], 10);
        await schedule(tx, id, [w.a, w.b]);
        await schedule(tx, other, [w.a]);
        await tx`select app.cancel_training_session(${id}, 'Instructor unavailable')`;
      });
      const rows = await tx<{ session_id: string; status: string }[]>`
        select l.session_id, a.status from training_session_assignments l join shift_assignments a on a.id = l.assignment_id order by l.session_id`;
      expect(rows.filter((r) => r.session_id === id).map((r) => r.status)).toEqual(['cancelled', 'cancelled']);
      expect(rows.filter((r) => r.session_id === other).map((r) => r.status)).toEqual(['scheduled']);
    });
  });

  it('a member withdrawing cancels only their own training row', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let id = '';
      await as(tx, w, w.mgr, async () => {
        id = await futureSession(tx, w, [w.a, w.b]);
        await schedule(tx, id, [w.a, w.b]);
      });
      await as(tx, w, w.a, async () => {
        await tx`select app.withdraw_training(${id})`;
      });
      const rows = await tx<{ member_id: string; status: string }[]>`
        select a.member_id, a.status from training_session_assignments l join shift_assignments a on a.id = l.assignment_id`;
      expect(rows.find((r) => r.member_id === w.a.m)!.status).toBe('cancelled');
      expect(rows.find((r) => r.member_id === w.b.m)!.status).toBe('scheduled');
    });
  });
});

describe('compliance inputs', () => {
  async function withHours(tx: Tx, w: W) {
    let id = '';
    await as(tx, w, w.mgr, async () => {
      const start = new Date(Date.now() - 3 * 3_600_000);
      const end = new Date(start.getTime() + 2 * 3_600_000);
      id = (await tx<{ id: string }[]>`
        select app.create_training_session(${w.course}, 'Past drill', ${start.toISOString()}, ${end.toISOString()}, null, null, null, null, false, 2, null,
          ${tx.json([w.a, w.b, w.c].map((m) => ({ kind: 'member', ref_id: m.m })) as never)}) as id`)[0]!.id;
      await tx`select app.publish_training_session(${id})`;
      for (const m of [w.a, w.b, w.c]) {
        const [e] = await tx<{ id: string }[]>`select id from training_enrollments where session_id = ${id} and member_id = ${m.m}`;
        await tx`select app.mark_training_attendance(${e!.id}, 'attended', null, null)`;
      }
    });
    return id;
  }

  it('members see only themselves, unit viewers their unit, department viewers everyone', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await withHours(tx, w);
      const names = (who: Who, unit: string | null = null) =>
        as(tx, w, who, async () => (await tx<{ member_id: string }[]>`select member_id from app.training_compliance_members(${unit})`).map((r) => r.member_id).sort());
      expect(await names(w.a)).toEqual([w.a.m]);
      // The officer sees their own unit (a, b) and always themselves, never station 2.
      expect(await names(w.officer1)).toEqual([w.a.m, w.b.m, w.officer1.m].sort());
      expect(await names(w.mgr)).toEqual(expect.arrayContaining([w.a.m, w.b.m, w.c.m]));
      expect(await names(w.mgr, w.s2)).toEqual([w.c.m]);
    });
  });

  it('returns hours only for members the caller may see', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await withHours(tx, w);
      const hours = (who: Who) =>
        as(tx, w, who, async () => (await tx<{ member_id: string; hours: string }[]>`
          select member_id, hours::text from app.training_compliance_hours(${[w.a.m, w.b.m, w.c.m]}::uuid[])`).map((r) => r.member_id).sort());
      expect(await hours(w.a)).toEqual([w.a.m]);
      expect(await hours(w.officer1)).toEqual([w.a.m, w.b.m].sort());
      expect(await hours(w.mgr)).toEqual([w.a.m, w.b.m, w.c.m].sort());
    });
  });
});

describe('reminder log', () => {
  it('is readable by department compliance viewers only, never writable by users, and sends each reminder once', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const [req] = await tx<{ id: string }[]>`select gen_random_uuid() as id`;
      await tx`insert into training_reminder_log (tenant_id, member_id, kind, ref_id, level, window_end) values (${w.t}, ${w.a.m}, 'requirement', ${req!.id}, 'overdue', '2026-12-31')`;
      await expectDbError(tx, /training_reminder_once|duplicate key/, () =>
        tx`insert into training_reminder_log (tenant_id, member_id, kind, ref_id, level, window_end) values (${w.t}, ${w.a.m}, 'requirement', ${req!.id}, 'overdue', '2026-12-31')`);
      // A later window is a new reminder.
      await tx`insert into training_reminder_log (tenant_id, member_id, kind, ref_id, level, window_end) values (${w.t}, ${w.a.m}, 'requirement', ${req!.id}, 'overdue', '2027-12-31')`;
      const count = (who: Who) => as(tx, w, who, async () => (await tx`select 1 from training_reminder_log`).length);
      expect(await count(w.mgr)).toBe(2);
      expect(await count(w.officer1)).toBe(0);   // unit scope is not enough
      expect(await count(w.a)).toBe(0);
      await as(tx, w, w.mgr, async () => {
        await expectDbError(tx, /permission denied/, () => tx`delete from training_reminder_log`);
      });
    });
  });
});
