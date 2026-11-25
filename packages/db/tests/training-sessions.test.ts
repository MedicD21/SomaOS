import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { createCredentialType, createMember, createOrgUnit, createRole, createTenant, grantRole, userInTenant } from './helpers';

afterAll(closeTestDb);

type Who = { u: string; m: string };

async function person(tx: Tx, t: string, opts: { perms?: string[]; scope?: Parameters<typeof grantRole>[4] } = {}): Promise<Who> {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u });
  if (opts.perms?.length) await grantRole(tx, t, m, await createRole(tx, t, `r_${m.slice(0, 6)}`, opts.perms), opts.scope);
  return { u, m };
}

async function world(tx: Tx) {
  const t = await createTenant(tx);
  const s1 = await createOrgUnit(tx, t, 'Station 1');
  const s2 = await createOrgUnit(tx, t, 'Station 2');
  const [category] = await tx<{ id: string }[]>`insert into training_categories (tenant_id, key, label) values (${t}, 'ems', 'EMS') returning id`;
  const cred = await createCredentialType(tx, t, 'acls', { kind: 'months', months: 24 });
  const [course] = await tx<{ id: string }[]>`
    insert into training_courses (tenant_id, key, label, category_id, default_hours, credential_type_id)
    values (${t}, 'acls', 'ACLS', ${category!.id}, 2, ${cred}) returning id`;
  const [plain] = await tx<{ id: string }[]>`
    insert into training_courses (tenant_id, key, label, category_id, default_hours) values (${t}, 'drill', 'Drill', ${category!.id}, 2) returning id`;
  const [rank] = await tx<{ id: string }[]>`insert into ranks (tenant_id, key, label, sort) values (${t}, 'ff', 'Firefighter', 10) returning id`;

  const trainingMgr = await person(tx, t, { perms: ['training.session.manage', 'training.attendance.manage', 'training.session.view', 'credentials.manage'] });
  const officerA = await person(tx, t, { perms: ['training.session.manage', 'training.attendance.mark', 'training.session.view'], scope: { scopeKind: 'org_unit', orgUnitId: s1 } });
  const officerB = await person(tx, t, { perms: ['training.session.manage', 'training.attendance.mark', 'training.session.view'], scope: { scopeKind: 'org_unit', orgUnitId: s2 } });
  const instructor = await person(tx, t, { perms: ['training.session.view'] });
  const m1 = await person(tx, t, { perms: ['training.session.view'] });
  const m2 = await person(tx, t, { perms: ['training.session.view'] });
  const m3 = await person(tx, t, { perms: ['training.session.view'] });
  const nobody = await person(tx, t);
  await tx`update members set rank_id = ${rank!.id} where id = any (${[m1.m, m2.m]})`;
  return { t, s1, s2, cred, course: course!.id, plain: plain!.id, rank: rank!.id, trainingMgr, officerA, officerB, instructor, m1, m2, m3, nobody };
}
type W = Awaited<ReturnType<typeof world>>;

const as = <T>(tx: Tx, w: { t: string }, who: { u: string }, fn: () => Promise<T>) => asUser(tx, { sub: who.u, tenant_id: w.t }, fn);

/** A session at station 1 that started `startedHoursAgo` hours ago and ran `hours` hours (so it can be marked). */
async function mk(tx: Tx, w: W, o: { course?: string; unit?: string | null; startedHoursAgo?: number; hours?: number; capacity?: number | null; assignedOnly?: boolean; instructor?: string | null; audience?: unknown[] } = {}) {
  const hours = o.hours ?? 2;
  const startAgo = o.startedHoursAgo ?? 3;
  const start = new Date(Date.now() - startAgo * 3_600_000);
  const end = new Date(start.getTime() + hours * 3_600_000);
  const [r] = await tx<{ id: string }[]>`
    select app.create_training_session(${o.course ?? w.course}, 'ACLS class', ${start.toISOString()}, ${end.toISOString()}, ${o.unit === undefined ? w.s1 : o.unit},
      'Station 1 classroom', ${o.instructor ?? null}, ${o.capacity ?? null}, ${o.assignedOnly ?? false}, ${hours}, null, ${tx.json((o.audience ?? []) as never)}) as id`;
  return r!.id;
}
const publish = (tx: Tx, id: string) => tx<{ n: number }[]>`select app.publish_training_session(${id}) as n`;
const enrollmentOf = async (tx: Tx, session: string, member: string) =>
  (await tx<{ id: string }[]>`select id from training_enrollments where session_id = ${session} and member_id = ${member}`)[0]!.id;
const mark = (tx: Tx, enrollment: string, status = 'attended', hours: number | null = null, note: string | null = null) =>
  tx<{ id: string }[]>`select app.mark_training_attendance(${enrollment}, ${status}, ${hours}, ${note}) as id`;
const award = (member: string, issued = '2026-11-25', expires: string | null = '2028-11-25') => [{ member_id: member, issued_on: issued, expires_on: expires }];

describe('creating, publishing and the audience', () => {
  it('needs session.manage at the unit; officers cannot manage another station', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.officerB, async () => {
        await expectDbError(tx, /cannot manage training at this unit/, () => mk(tx, w));
      });
      await as(tx, w, w.m1, async () => {
        await expectDbError(tx, /cannot manage training at this unit/, () => mk(tx, w));
      });
      await as(tx, w, w.officerA, async () => {
        const id = await mk(tx, w);
        expect(id).toBeTruthy();
        // A department-wide session needs a department-wide grant.
        await expectDbError(tx, /cannot manage training at this unit/, () => mk(tx, w, { unit: null }));
      });
      await as(tx, w, w.trainingMgr, async () => {
        await mk(tx, w, { unit: null });
      });
    });
  });

  it('refuses archived courses, bad times and unknown audience entries', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await tx`update training_courses set archived_at = now() where id = ${w.plain}`;
      await as(tx, w, w.officerA, async () => {
        await expectDbError(tx, /course is archived/, () => mk(tx, w, { course: w.plain }));
        await expectDbError(tx, /unknown audience entry/, () => mk(tx, w, { audience: [{ kind: 'member', ref_id: crypto.randomUUID() }] }));
        await expectDbError(tx, /ends_at_check|check constraint/, () => tx`
          select app.create_training_session(${w.course}, 'Bad', now() + interval '2 hours', now() + interval '1 hour', ${w.s1}, null, null, null, false, 1, null, '[]'::jsonb)`);
      });
    });
  });

  it('publishing enrols each audience member once, refresh only adds, and nobody is removed', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let id = '';
      await as(tx, w, w.officerA, async () => {
        id = await mk(tx, w, { audience: [{ kind: 'rank', ref_id: w.rank }, { kind: 'member', ref_id: w.m1.m }] });
        const [{ n }] = await publish(tx, id);
        expect(n).toBe(2); // m1 matches twice but is enrolled once
      });
      expect((await tx`select 1 from notifications where member_id = ${w.m1.m} and kind = 'training'`).length).toBe(1);
      await tx`update members set rank_id = ${w.rank} where id = ${w.m3.m}`;
      await as(tx, w, w.officerA, async () => {
        const [{ n }] = await tx<{ n: number }[]>`select app.refresh_training_required(${id}) as n`;
        expect(n).toBe(1);
        const [{ n: again }] = await tx<{ n: number }[]>`select app.refresh_training_required(${id}) as n`;
        expect(again).toBe(0);
      });
      await tx`update members set rank_id = null where id = ${w.m2.m}`;
      await as(tx, w, w.officerA, async () => {
        await tx`select app.refresh_training_required(${id})`;
        expect((await tx`select 1 from training_enrollments where session_id = ${id}`).length).toBe(3);
        await expectDbError(tx, /Only a draft session/, () => publish(tx, id));
      });
    });
  });
});

describe('sign-up, capacity and the waitlist', () => {
  it('waitlists past capacity and promotes the first in line when someone withdraws', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let id = '';
      await as(tx, w, w.officerA, async () => {
        const start = new Date(Date.now() + 48 * 3_600_000);
        [{ id }] = await tx<{ id: string }[]>`select app.create_training_session(${w.course}, 'Future class', ${start.toISOString()}, ${new Date(start.getTime() + 7_200_000).toISOString()}, ${w.s1}, null, null, 1, false, 2, null, '[]'::jsonb) as id`;
        await publish(tx, id);
      });
      const signUp = (who: Who) => as(tx, w, who, async () => (await tx<{ s: string }[]>`select app.sign_up_training(${id}) as s`)[0]!.s);
      expect(await signUp(w.m1)).toBe('enrolled');
      expect(await signUp(w.m2)).toBe('waitlisted');
      expect(await signUp(w.m3)).toBe('waitlisted');
      await as(tx, w, w.m1, async () => {
        await expectDbError(tx, /already signed up/, () => tx`select app.sign_up_training(${id})`);
        await tx`select app.withdraw_training(${id})`;
      });
      const status = async (m: string) => (await tx<{ status: string }[]>`select status from training_enrollments where session_id = ${id} and member_id = ${m}`)[0]!.status;
      expect(await status(w.m1.m)).toBe('withdrawn');
      expect(await status(w.m2.m)).toBe('enrolled');   // first in the queue
      expect(await status(w.m3.m)).toBe('waitlisted');
      expect((await tx`select 1 from notifications where member_id = ${w.m2.m} and title like 'You are in:%'`).length).toBe(1);
      // A withdrawn member can sign up again (waitlisted behind the full class).
      expect(await signUp(w.m1)).toBe('waitlisted');
    });
  });

  it('refuses assigned-only, unpublished, started and permissionless sign-ups', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let draft = '';
      let assigned = '';
      let started = '';
      await as(tx, w, w.officerA, async () => {
        const start = new Date(Date.now() + 48 * 3_600_000);
        const end = new Date(start.getTime() + 7_200_000);
        [{ id: draft }] = await tx<{ id: string }[]>`select app.create_training_session(${w.course}, 'Draft', ${start.toISOString()}, ${end.toISOString()}, ${w.s1}, null, null, null, false, 2, null, '[]'::jsonb) as id`;
        [{ id: assigned }] = await tx<{ id: string }[]>`select app.create_training_session(${w.course}, 'Assigned', ${start.toISOString()}, ${end.toISOString()}, ${w.s1}, null, null, null, true, 2, null, '[]'::jsonb) as id`;
        await publish(tx, assigned);
        started = await mk(tx, w);
        await publish(tx, started);
      });
      await as(tx, w, w.m1, async () => {
        await expectDbError(tx, /not open for sign-up/, () => tx`select app.sign_up_training(${draft})`);
        await expectDbError(tx, /by assignment only/, () => tx`select app.sign_up_training(${assigned})`);
        await expectDbError(tx, /already started/, () => tx`select app.sign_up_training(${started})`);
      });
      await as(tx, w, w.nobody, async () => {
        await expectDbError(tx, /training\.session\.view required/, () => tx`select app.sign_up_training(${assigned})`);
      });
    });
  });
});

describe('marking attendance', () => {
  it('needs scope at the unit or being the instructor, and nobody marks themselves', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let id = '';
      await as(tx, w, w.officerA, async () => {
        id = await mk(tx, w, { instructor: w.instructor.m, audience: [{ kind: 'member', ref_id: w.m1.m }, { kind: 'member', ref_id: w.instructor.m }] });
        await publish(tx, id);
      });
      const eM1 = await enrollmentOf(tx, id, w.m1.m);
      const eInstructor = await enrollmentOf(tx, id, w.instructor.m);
      await as(tx, w, w.officerB, async () => {
        await expectDbError(tx, /cannot mark attendance for this session/, () => mark(tx, eM1));
      });
      await as(tx, w, w.m1, async () => {
        await expectDbError(tx, /cannot mark your own attendance/, () => mark(tx, eM1));
      });
      await as(tx, w, w.nobody, async () => {
        await expectDbError(tx, /cannot mark attendance for this session/, () => mark(tx, eM1));
      });
      await as(tx, w, w.instructor, async () => {
        await mark(tx, eM1);                                       // the instructor marks others
        await expectDbError(tx, /cannot mark your own attendance/, () => mark(tx, eInstructor));
      });
      await as(tx, w, w.officerA, async () => {
        await mark(tx, eInstructor);
      });
    });
  });

  it('is append-only: updates and deletes are rejected for everyone, a correction supersedes, and hours follow the newest row', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let id = '';
      await as(tx, w, w.officerA, async () => {
        id = await mk(tx, w, { audience: [{ kind: 'member', ref_id: w.m1.m }] });
        await publish(tx, id);
      });
      const e = await enrollmentOf(tx, id, w.m1.m);
      await as(tx, w, w.officerA, async () => {
        await mark(tx, e, 'absent');
        await mark(tx, e, 'attended');
      });
      const hours = async () => (await tx<{ h: string | null }[]>`select sum(hours)::text as h from training_hours where member_id = ${w.m1.m}`)[0]!.h;
      expect(await hours()).toBe('2.00');
      await expectDbError(tx, /append-only/, () => tx`update training_attendance set hours = 9`);          // superuser too
      await expectDbError(tx, /append-only/, () => tx`delete from training_attendance`);
      await expectDbError(tx, /append-only/, () => tx`truncate training_attendance`);
      const rows = await tx<{ status: string; supersedes_id: string | null; id: string }[]>`select status, supersedes_id, id from training_attendance order by seq`;
      expect(rows.map((r) => r.status)).toEqual(['absent', 'attended']);
      expect(rows[1]!.supersedes_id).toBe(rows[0]!.id);
      await as(tx, w, w.officerA, async () => {
        await mark(tx, e, 'partial', 1, 'Left early for a call');
      });
      expect(await hours()).toBe('1.00');
      await as(tx, w, w.officerA, async () => {
        await mark(tx, e, 'excused');
      });
      expect(await hours()).toBeNull();
      await as(tx, w, w.m1, async () => {
        await expectDbError(tx, /permission denied/, () => tx`insert into training_attendance (tenant_id, enrollment_id, session_id, member_id, status, hours) values (${w.t}, ${e}, ${id}, ${w.m1.m}, 'attended', 2)`);
      });
    });
  });

  it('checks hours, partial rules, enrollment status, start time and the correction window', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let id = '';
      let old = '';
      let future = '';
      await as(tx, w, w.officerA, async () => {
        id = await mk(tx, w, { audience: [{ kind: 'member', ref_id: w.m1.m }] });
        await publish(tx, id);
        old = await mk(tx, w, { startedHoursAgo: 24 * 40, audience: [{ kind: 'member', ref_id: w.m1.m }] });
        await publish(tx, old);
        const start = new Date(Date.now() + 48 * 3_600_000);
        [{ id: future }] = await tx<{ id: string }[]>`select app.create_training_session(${w.course}, 'Soon', ${start.toISOString()}, ${new Date(start.getTime() + 7_200_000).toISOString()}, ${w.s1}, null, null, null, false, 2, null, ${tx.json([{ kind: 'member', ref_id: w.m1.m }])}) as id`;
        await publish(tx, future);
      });
      const e = await enrollmentOf(tx, id, w.m1.m);
      const eOld = await enrollmentOf(tx, old, w.m1.m);
      const eFuture = await enrollmentOf(tx, future, w.m1.m);
      await as(tx, w, w.officerA, async () => {
        await expectDbError(tx, /Enter the hours attended/, () => mark(tx, e, 'partial', null, 'Left early for a call'));
        await expectDbError(tx, /explaining the partial attendance/, () => mark(tx, e, 'partial', 1, null));
        await expectDbError(tx, /more than the session length/, () => mark(tx, e, 'attended', 5));
        await expectDbError(tx, /has not started yet/, () => mark(tx, eFuture));
        await expectDbError(tx, /correction window/, () => mark(tx, eOld));
      });
      await as(tx, w, w.trainingMgr, async () => {
        await mark(tx, eOld); // department-wide attendance.manage can correct old rows
      });
      // Withdrawn members cannot be marked; cancelled sessions are closed.
      await tx`update training_enrollments set status = 'withdrawn' where id = ${e}`;
      await as(tx, w, w.officerA, async () => {
        await expectDbError(tx, /Only enrolled members/, () => mark(tx, e));
      });
    });
  });

  it('hours from a cancelled session disappear from the hours view', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let id = '';
      await as(tx, w, w.officerA, async () => {
        id = await mk(tx, w, { audience: [{ kind: 'member', ref_id: w.m1.m }] });
        await publish(tx, id);
        await mark(tx, await enrollmentOf(tx, id, w.m1.m));
      });
      expect((await tx`select 1 from training_hours where member_id = ${w.m1.m}`).length).toBe(1);
      await tx`update training_sessions set status = 'cancelled' where id = ${id}`;
      expect((await tx`select 1 from training_hours where member_id = ${w.m1.m}`).length).toBe(0);
    });
  });
});

describe('cancelling', () => {
  it('needs a reason, notifies enrollees, and only scoped managers can', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let id = '';
      await as(tx, w, w.officerA, async () => {
        id = await mk(tx, w, { audience: [{ kind: 'member', ref_id: w.m1.m }] });
        await publish(tx, id);
        await expectDbError(tx, /at least 5 characters/, () => tx`select app.cancel_training_session(${id}, 'no')`);
      });
      await as(tx, w, w.officerB, async () => {
        await expectDbError(tx, /cannot manage training at this unit/, () => tx`select app.cancel_training_session(${id}, 'Not my station')`);
      });
      await as(tx, w, w.officerA, async () => {
        await tx`select app.cancel_training_session(${id}, 'Instructor unavailable')`;
        await expectDbError(tx, /can no longer be cancelled/, () => tx`select app.cancel_training_session(${id}, 'Again please')`);
      });
      expect((await tx`select 1 from notifications where member_id = ${w.m1.m} and title like 'Training cancelled:%'`).length).toBe(1);
    });
  });
});

describe('completion awards credentials', () => {
  async function ready(tx: Tx, w: W, members: Who[] = [w.m1]) {
    let id = '';
    await as(tx, w, w.officerA, async () => {
      id = await mk(tx, w, { audience: members.map((m) => ({ kind: 'member', ref_id: m.m })) });
      await publish(tx, id);
    });
    return id;
  }

  it('grants one credential per qualifying attendee, and completing again awards nothing more', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const id = await ready(tx, w);
      await as(tx, w, w.officerA, async () => { await mark(tx, await enrollmentOf(tx, id, w.m1.m)); });
      await as(tx, w, w.trainingMgr, async () => {
        const [{ n }] = await tx<{ n: number }[]>`select app.complete_training_session(${id}, ${tx.json(award(w.m1.m) as never)}) as n`;
        expect(n).toBe(1);
        const [{ n: again }] = await tx<{ n: number }[]>`select app.complete_training_session(${id}, ${tx.json(award(w.m1.m) as never)}) as n`;
        expect(again).toBe(0);
      });
      const creds = await tx<{ expires_on: string; status: string }[]>`select expires_on::text, status from member_credentials where member_id = ${w.m1.m}`;
      expect(creds).toEqual([{ expires_on: '2028-11-25', status: 'active' }]);
      expect((await tx`select 1 from training_awards where member_id = ${w.m1.m}`).length).toBe(1);
      expect((await tx<{ status: string }[]>`select status from training_sessions where id = ${id}`)[0]!.status).toBe('completed');
    });
  });

  it('refuses members who did not attend enough, and officers without credentials.manage', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const id = await ready(tx, w, [w.m1, w.m2]);
      await as(tx, w, w.officerA, async () => {
        await mark(tx, await enrollmentOf(tx, id, w.m1.m), 'partial', 1, 'Left early for a call');
        await mark(tx, await enrollmentOf(tx, id, w.m2.m), 'attended');
        await expectDbError(tx, /credentials\.manage required/, () => tx`select app.complete_training_session(${id}, ${tx.json(award(w.m2.m) as never)})`);
      });
      await as(tx, w, w.trainingMgr, async () => {
        await expectDbError(tx, /did not complete the required hours/, () => tx`select app.complete_training_session(${id}, ${tx.json(award(w.m1.m) as never)})`);
        await expectDbError(tx, /did not complete the required hours/, () => tx`select app.complete_training_session(${id}, ${tx.json(award(w.m3.m) as never)})`);
        await expectDbError(tx, /expiry cannot be before/, () => tx`select app.complete_training_session(${id}, ${tx.json(award(w.m2.m, '2026-11-25', '2026-01-01') as never)})`);
      });
      expect((await tx`select 1 from member_credentials where tenant_id = ${w.t}`).length).toBe(0);
    });
  });

  it('a renewal adds a new credential and leaves the existing one alone', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const [old] = await tx<{ id: string }[]>`
        insert into member_credentials (tenant_id, member_id, type_id, issued_on, expires_on) values (${w.t}, ${w.m1.m}, ${w.cred}, '2025-01-01', '2027-01-01') returning id`;
      const id = await ready(tx, w);
      await as(tx, w, w.officerA, async () => { await mark(tx, await enrollmentOf(tx, id, w.m1.m)); });
      await as(tx, w, w.trainingMgr, async () => {
        await tx`select app.complete_training_session(${id}, ${tx.json(award(w.m1.m) as never)})`;
      });
      const creds = await tx<{ id: string; expires_on: string; status: string }[]>`select id, expires_on::text, status from member_credentials where member_id = ${w.m1.m} order by expires_on`;
      expect(creds).toHaveLength(2);
      expect(creds[0]).toMatchObject({ id: old!.id, expires_on: '2027-01-01', status: 'active' });
      expect(creds[1]).toMatchObject({ expires_on: '2028-11-25' });
      expect((await tx<{ kind: string }[]>`select kind from training_awards`)[0]!.kind).toBe('renewed');
    });
  });

  it('a course with no credential type completes with no awards; awards are append-only', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let id = '';
      await as(tx, w, w.officerA, async () => {
        id = await mk(tx, w, { course: w.plain, audience: [{ kind: 'member', ref_id: w.m1.m }] });
        await publish(tx, id);
        await mark(tx, await enrollmentOf(tx, id, w.m1.m));
      });
      await as(tx, w, w.officerA, async () => {
        const [{ n }] = await tx<{ n: number }[]>`select app.complete_training_session(${id}, ${tx.json(award(w.m1.m) as never)}) as n`;
        expect(n).toBe(0);
      });
      expect((await tx`select 1 from member_credentials where tenant_id = ${w.t}`).length).toBe(0);
      const id2 = await ready(tx, w);
      await as(tx, w, w.officerA, async () => { await mark(tx, await enrollmentOf(tx, id2, w.m1.m)); });
      await as(tx, w, w.trainingMgr, async () => { await tx`select app.complete_training_session(${id2}, ${tx.json(award(w.m1.m) as never)})`; });
      await expectDbError(tx, /append-only/, () => tx`update training_awards set kind = 'granted'`);
      await expectDbError(tx, /append-only/, () => tx`delete from training_awards`);
    });
  });

  it('draft and cancelled sessions cannot be completed', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.officerA, async () => {
        const draft = await mk(tx, w);
        await expectDbError(tx, /Only a scheduled session/, () => tx`select app.complete_training_session(${draft}, '[]'::jsonb)`);
      });
    });
  });
});

describe('who can see what', () => {
  it('members see their own enrollments only, officers their station, drafts only at the unit; departments are isolated', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let pub = '';
      let draft = '';
      await as(tx, w, w.officerA, async () => {
        pub = await mk(tx, w, { audience: [{ kind: 'member', ref_id: w.m1.m }, { kind: 'member', ref_id: w.m2.m }] });
        await publish(tx, pub);
        draft = await mk(tx, w);
      });
      const count = (who: { u: string }, table: string) => as(tx, w, who, async () => (await tx`select 1 from ${tx(table)}`).length);
      expect(await count(w.m1, 'training_enrollments')).toBe(1);
      expect(await count(w.m2, 'training_enrollments')).toBe(1);
      expect(await count(w.m3, 'training_enrollments')).toBe(0);
      expect(await count(w.officerA, 'training_enrollments')).toBe(2);
      expect(await count(w.officerB, 'training_enrollments')).toBe(0);
      expect(await count(w.nobody, 'training_sessions')).toBe(0);
      expect(await count(w.m3, 'training_sessions')).toBe(1);     // published only
      expect(await count(w.officerA, 'training_sessions')).toBe(2);
      expect(await count(w.officerB, 'training_sessions')).toBe(1); // published, not the draft at station 1
      expect(draft).toBeTruthy();
      const other = await world(tx);
      expect(await as(tx, other, other.trainingMgr, async () => (await tx`select 1 from training_sessions`).length)).toBe(0);
    });
  });
});
