import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { sendTrainingReminders, TRAINING_REMINDER_KIND } from '../../src/jobs/training-reminders';

const sql = postgres(process.env.SOMA_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { onnotice: () => undefined });

afterAll(async () => {
  // Append-only tables block deleting the department; it is cleared by the next database reset.
  await sql.end();
});

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function department() {
  const slug = `train-${uid()}`;
  const [t] = await sql`insert into tenants (name, slug, timezone, department_type) values ('Training Test', ${slug}, 'America/Chicago', 'career') returning id`;
  const tenant = t!.id as string;
  await sql`insert into tenant_settings (tenant_id, enabled_modules) values (${tenant}, ${['admin', 'training']})`;
  const member = async (first: string) =>
    (await sql`insert into members (tenant_id, first_name, last_name, employment_type) values (${tenant}, ${first}, 'Test', 'career_full_time') returning id`)[0]!.id as string;
  const [type] = await sql`insert into org_unit_types (tenant_id, key, label) values (${tenant}, 'station', 'Station') returning id`;
  const unit = async (name: string) => (await sql`insert into org_units (tenant_id, type_id, name) values (${tenant}, ${type!.id}, ${name}) returning id`)[0]!.id as string;
  const assign = (m: string, u: string) => sql`insert into member_assignments (tenant_id, member_id, org_unit_id, effective) values (${tenant}, ${m}, ${u}, '[2020-01-01,)')`;
  const [cat] = await sql`insert into training_categories (tenant_id, key, label) values (${tenant}, 'fire', 'Fire') returning id`;
  const [course] = await sql`insert into training_courses (tenant_id, key, label, category_id, default_hours) values (${tenant}, 'drill', 'Drill', ${cat!.id}, 2) returning id`;
  const [req] = await sql`
    insert into training_requirements (tenant_id, label, category_id, required_hours, span, effective_from)
    values (${tenant}, 'Annual fire hours', ${cat!.id}, 20, ${sql.json({ kind: 'calendar_year' })}, '2020-01-01') returning id`;
  /** Credits `hours` to the member from a past session starting at `startsAt` (inserted directly, as the owner). */
  const credit = async (m: string, hours: number, startsAt: string, status = 'scheduled') => {
    const [s] = await sql`
      insert into training_sessions (tenant_id, course_id, title, starts_at, ends_at, duration_hours, status)
      values (${tenant}, ${course!.id}, 'Past drill', ${startsAt}, ${new Date(new Date(startsAt).getTime() + 3_600_000 * hours).toISOString()}, ${hours}, ${status}) returning id`;
    const [e] = await sql`insert into training_enrollments (tenant_id, session_id, member_id, source) values (${tenant}, ${s!.id}, ${m}, 'added') returning id`;
    await sql`insert into training_attendance (tenant_id, enrollment_id, session_id, member_id, status, hours) values (${tenant}, ${e!.id}, ${s!.id}, ${m}, 'attended', ${hours})`;
    return s!.id as string;
  };
  const notes = async (m: string) => (await sql`select title from notifications where tenant_id = ${tenant} and member_id = ${m} and kind = 'training' order by created_at`).map((r) => r.title as string);
  return { tenant, member, unit, assign, cat: cat!.id as string, course: course!.id as string, req: req!.id as string, credit, notes };
}

const run = async (now: Date) => {
  await sql`delete from jobs where kind = ${TRAINING_REMINDER_KIND}`;
  return sendTrainingReminders(sql, now);
};

describe('requirement reminders', () => {
  it('reminds a short member once as the window closes, never a member who met it, and not twice', async () => {
    const d = await department();
    const short = await d.member('Short');
    const done = await d.member('Done');
    await d.credit(done, 20, '2026-03-01T15:00:00Z');
    const now = new Date('2026-12-05T12:00:00Z');   // 26 days before the year ends

    await run(now);
    expect(await d.notes(short)).toEqual(['Annual fire hours: 20 h still needed by 2026-12-31']);
    expect(await d.notes(done)).toEqual([]);
    await run(now);
    expect(await d.notes(short)).toHaveLength(1);                                              // a rerun sends nothing new
    expect((await sql`select 1 from jobs where kind = ${TRAINING_REMINDER_KIND} and status = 'pending'`).length).toBe(1);
  });

  it('stops reminding once the hours are earned, and does not count a cancelled session', async () => {
    const d = await department();
    const m = await d.member('Catchup');
    const cancelled = await d.credit(m, 20, '2026-03-01T15:00:00Z', 'cancelled');
    const now = new Date('2026-12-05T12:00:00Z');
    await run(now);
    expect(await d.notes(m)).toHaveLength(1);                                                  // the cancelled session earned nothing
    expect(cancelled).toBeTruthy();
    await d.credit(m, 20, '2026-04-01T15:00:00Z');
    await run(new Date('2026-12-06T12:00:00Z'));
    expect(await d.notes(m)).toHaveLength(1);                                                  // now met: nothing further
  });

  it('is overdue after the window ends short, and the officer digest is limited to the officer\'s own unit', async () => {
    const d = await department();
    const u1 = await d.unit('Station 1');
    const u2 = await d.unit('Station 2');
    const late = await d.member('Late');
    const other = await d.member('Elsewhere');
    await d.assign(late, u1);
    await d.assign(other, u2);
    await d.credit(late, 12, '2026-03-01T15:00:00Z');

    const [role] = await sql`insert into roles (tenant_id, key, label) values (${d.tenant}, 'viewer', 'Viewer') returning id`;
    await sql`insert into role_permissions (tenant_id, role_id, permission) values (${d.tenant}, ${role!.id}, 'training.compliance.view')`;
    const officer1 = await d.member('Officer1');
    const officer2 = await d.member('Officer2');
    const chief = await d.member('Chief');
    await sql`insert into role_grants (tenant_id, member_id, role_id, scope_kind, scope_org_unit_id, valid) values (${d.tenant}, ${officer1}, ${role!.id}, 'org_unit', ${u1}, tstzrange(now() - interval '1 day', null))`;
    await sql`insert into role_grants (tenant_id, member_id, role_id, scope_kind, scope_org_unit_id, valid) values (${d.tenant}, ${officer2}, ${role!.id}, 'org_unit', ${u2}, tstzrange(now() - interval '1 day', null))`;
    await sql`insert into role_grants (tenant_id, member_id, role_id, scope_kind, valid) values (${d.tenant}, ${chief}, ${role!.id}, 'department', tstzrange(now() - interval '1 day', null))`;

    const now = new Date('2027-01-10T12:00:00Z');   // the 2026 window ended 10 days ago
    await run(now);
    expect(await d.notes(late)).toEqual(['Annual fire hours: 8 h short']);
    // Station 1's officer and the chief hear about Late; station 2's officer hears about Elsewhere only.
    const digest = async (m: string) => (await d.notes(m)).filter((n) => n.includes('overdue'));
    expect(await digest(officer1)).toEqual(['1 member is overdue on required training']);
    expect(await digest(officer2)).toEqual(['1 member is overdue on required training']);
    // The chief sees every other overdue member in the department (the five have 12 h or none against 20 h; the chief is excluded).
    expect(await digest(chief)).toEqual(['4 members are overdue on required training']);
    await run(now);
    expect((await d.notes(late))).toHaveLength(1);
    expect(await digest(chief)).toHaveLength(1);                                               // one digest per officer per day
  });
});

describe('session reminders', () => {
  it('reminds enrolled members of a session starting within 24 hours, once', async () => {
    const d = await department();
    const m = await d.member('Soon');
    const now = new Date('2026-06-10T12:00:00Z');
    const [s] = await sql`
      insert into training_sessions (tenant_id, course_id, title, starts_at, ends_at, duration_hours, status)
      values (${d.tenant}, ${d.course}, 'Engine drill', ${new Date(now.getTime() + 5 * 3_600_000).toISOString()}, ${new Date(now.getTime() + 7 * 3_600_000).toISOString()}, 2, 'scheduled') returning id`;
    await sql`insert into training_enrollments (tenant_id, session_id, member_id, source) values (${d.tenant}, ${s!.id}, ${m}, 'added')`;
    const [far] = await sql`
      insert into training_sessions (tenant_id, course_id, title, starts_at, ends_at, duration_hours, status)
      values (${d.tenant}, ${d.course}, 'Next week', ${new Date(now.getTime() + 7 * 86_400_000).toISOString()}, ${new Date(now.getTime() + 7 * 86_400_000 + 7_200_000).toISOString()}, 2, 'scheduled') returning id`;
    await sql`insert into training_enrollments (tenant_id, session_id, member_id, source) values (${d.tenant}, ${far!.id}, ${m}, 'added')`;
    await run(now);
    expect((await d.notes(m)).filter((n) => n.startsWith('Training tomorrow'))).toEqual(['Training tomorrow: Engine drill']);
    await run(now);
    expect((await d.notes(m)).filter((n) => n.startsWith('Training tomorrow'))).toHaveLength(1);
  });
});
