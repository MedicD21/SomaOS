import { afterAll, describe, expect, it } from 'vitest';
import { credentialExpiry } from '@soma/schedule-engine';
import { asUser, closeTestDb, withAdmin, type Tx } from '@soma/db/src/test-harness';
import { friendlyDbError } from '@/server/actions';
import { loadCompliance } from '@/server/training/compliance';
import { loadAwardCandidates, loadCatalog, loadUpcomingSessions } from '@/server/training/load';

afterAll(() => closeTestDb());

type Demo = { tenantId: string; adminId: string; memberUserId: string; rileyId: string };

async function demo(tx: Tx): Promise<Demo> {
  const [row] = await tx<Demo[]>`
    select t.id as "tenantId", a.id as "adminId", u.id as "memberUserId", m.id as "rileyId"
    from tenants t, auth.users a, auth.users u, members m
    where t.slug = 'demo-fire-rescue' and a.email = 'admin@soma.local' and u.email = 'member@soma.local'
      and m.user_id = u.id and m.tenant_id = t.id`;
  if (!row) throw new Error('Demo Fire Rescue is not seeded; run supabase db reset && pnpm db:seed');
  return row;
}

const asAdmin = <T>(tx: Tx, d: Demo, fn: () => Promise<T>) => asUser(tx, { sub: d.adminId, tenant_id: d.tenantId }, fn);
const asMember = <T>(tx: Tx, d: Demo, fn: () => Promise<T>) => asUser(tx, { sub: d.memberUserId, tenant_id: d.tenantId }, fn);

describe('error messages', () => {
  it('shows the database\'s plain-English training messages, not a generic failure', () => {
    for (const msg of [
      'That session is not open for sign-up',
      'You are already signed up for that session',
      'The correction window for that session has closed',
      'not allowed: you cannot mark your own attendance',
      'Only enrolled members can be marked',
      'Hours cannot be more than the session length',
      'Pat Medic did not complete the required hours for this course',
      'That requirement overlaps another for the same category, rank and role',
      'That training course is archived',
    ]) {
      expect(friendlyDbError(new Error(msg)).toLowerCase()).toBe(msg.toLowerCase());
    }
  });
});

describe('the starter catalog', () => {
  it('is applied to the demo department, with example requirements that start next year', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await asAdmin(tx, d, async () => {
        const cat = await loadCatalog(tx);
        expect(cat.categories.map((c) => c.key)).toEqual(expect.arrayContaining(['fire', 'ems', 'hazmat']));
        expect(cat.courses.find((c) => c.key === 'cpr_renewal')).toMatchObject({ credentialLabel: 'CPR' });
        const year = new Date().getUTCFullYear();
        for (const r of cat.requirements) expect(r.effectiveFrom).toBe(`${year + 1}-01-01`);
      });
    });
  });
});

describe('sessions and completion', () => {
  async function pastSession(tx: Tx, d: Demo, publish = true): Promise<string> {
    const [c] = await tx<{ id: string }[]>`select id from training_courses where tenant_id = ${d.tenantId} and key = 'cpr_renewal'`;
    const start = new Date(Date.now() - 6 * 3_600_000);
    const [s] = await tx<{ id: string }[]>`
      select app.create_training_session(${c!.id}, 'CPR class', ${start.toISOString()}, ${new Date(start.getTime() + 4 * 3_600_000).toISOString()}, null, 'Classroom',
        null, null, false, 4, null, ${tx.json([{ kind: 'member', ref_id: d.rileyId }])}) as id`;
    if (publish) await tx`select app.publish_training_session(${s!.id})`;
    return s!.id;
  }

  it('members see published sessions but not drafts', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      let published = '';
      let draft = '';
      await asAdmin(tx, d, async () => {
        published = await pastSession(tx, d);
        draft = await pastSession(tx, d, false);
      });
      await asMember(tx, d, async () => {
        const ids = (await loadUpcomingSessions(tx)).map((s) => s.id);
        expect(ids).toContain(published);
        expect(ids).not.toContain(draft);
      });
      await asAdmin(tx, d, async () => {
        expect((await loadUpcomingSessions(tx)).map((s) => s.id)).toContain(draft);
      });
    });
  });

  it('the completion preview matches the credential the database writes', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      let id = '';
      let preview: Awaited<ReturnType<typeof loadAwardCandidates>> | null = null;
      await asAdmin(tx, d, async () => {
        id = await pastSession(tx, d);
        const [e] = await tx<{ id: string }[]>`select id from training_enrollments where session_id = ${id} and member_id = ${d.rileyId}`;
        await tx`select app.mark_training_attendance(${e!.id}, 'attended', null, null)`;
        preview = await loadAwardCandidates(tx, id, 'America/New_York');
        const awards = preview.candidates.map((c) => ({ member_id: c.memberId, issued_on: c.issuedOn, expires_on: c.expiresOn }));
        await tx`select app.complete_training_session(${id}, ${tx.json(awards as never)})`;
      });
      expect(preview!.credentialLabel).toBe('CPR');
      expect(preview!.candidates).toHaveLength(1);
      const [cand] = preview!.candidates;
      expect(cand!.expiresOn).toBe(credentialExpiry({ kind: 'months', months: 24 }, cand!.issuedOn));
      const [cred] = await tx<{ issued_on: string; expires_on: string }[]>`
        select issued_on::text, expires_on::text from member_credentials c join training_awards w on w.credential_id = c.id where w.session_id = ${id}`;
      expect(cred).toEqual({ issued_on: cand!.issuedOn, expires_on: cand!.expiresOn });
      // Once awarded, nobody is left to award.
      await asAdmin(tx, d, async () => {
        expect((await loadAwardCandidates(tx, id, 'America/New_York')).candidates).toEqual([]);
      });
    });
  });
});

describe('compliance as the caller sees it', () => {
  it('a member sees only their own rows; hours count toward an everyone-requirement', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      const year = new Date().getUTCFullYear();
      const [c] = await tx<{ id: string }[]>`select id from training_categories where tenant_id = ${d.tenantId} and key = 'fire'`;
      await tx`insert into training_requirements (tenant_id, label, category_id, required_hours, span, effective_from, effective_to)
               values (${d.tenantId}, 'Test requirement', ${c!.id}, 10, ${tx.json({ kind: 'calendar_year' })}, ${`${year - 1}-01-01`}, ${`${year}-12-31`})`;
      const [course] = await tx<{ id: string }[]>`select id from training_courses where tenant_id = ${d.tenantId} and key = 'company_drill'`;
      const start = new Date(Date.now() - 6 * 3_600_000);
      const [s] = await tx<{ id: string }[]>`
        insert into training_sessions (tenant_id, course_id, title, starts_at, ends_at, duration_hours, status)
        values (${d.tenantId}, ${course!.id}, 'Drill', ${start.toISOString()}, ${new Date(start.getTime() + 4 * 3_600_000).toISOString()}, 4, 'scheduled') returning id`;
      const [e] = await tx<{ id: string }[]>`insert into training_enrollments (tenant_id, session_id, member_id, source) values (${d.tenantId}, ${s!.id}, ${d.rileyId}, 'added') returning id`;
      await tx`insert into training_attendance (tenant_id, enrollment_id, session_id, member_id, status, hours) values (${d.tenantId}, ${e!.id}, ${s!.id}, ${d.rileyId}, 'attended', 4)`;

      await asMember(tx, d, async () => {
        const { rows } = await loadCompliance(tx, 'America/New_York', null);
        expect(new Set(rows.map((r) => r.memberId))).toEqual(new Set([d.rileyId]));
        expect(rows.find((r) => r.requirementLabel === 'Test requirement')).toMatchObject({ earned: 4, required: 10, status: 'on_track' });
      });
      await asAdmin(tx, d, async () => {
        const { rows } = await loadCompliance(tx, 'America/New_York', null);
        expect(new Set(rows.map((r) => r.memberId)).size).toBeGreaterThan(1);
      });
    });
  });
});
