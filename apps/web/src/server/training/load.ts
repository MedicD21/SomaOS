import 'server-only';
import { credentialExpiry, localDateOf, type IsoDate, type TrainingWindow, type Validity } from '@soma/schedule-engine';
import type { Tx } from '@/server/db';

export type Option = { id: string; label: string };

export type Category = { id: string; key: string; label: string; externalCode: string | null; archived: boolean };
export type Course = {
  id: string; key: string; label: string; categoryId: string; categoryLabel: string; defaultHours: number;
  credentialTypeId: string | null; credentialLabel: string | null; minHoursPct: number; description: string | null; archived: boolean;
};
export type Requirement = {
  id: string; label: string; categoryId: string; categoryLabel: string; rankId: string | null; rankLabel: string | null;
  roleId: string | null; roleLabel: string | null; requiredHours: number; window: TrainingWindow;
  effectiveFrom: string; effectiveTo: string | null; archived: boolean;
};

export type Catalog = {
  categories: Category[]; courses: Course[]; requirements: Requirement[];
  ranks: Option[]; roles: Option[]; credentialTypes: Option[];
};

/** The catalog and the pick-lists the admin forms need. Reads are limited by RLS to course viewers. */
export async function loadCatalog(tx: Tx): Promise<Catalog> {
  const categories = await tx<Category[]>`
    select id, key, label, external_code as "externalCode", archived_at is not null as archived
    from training_categories order by archived_at nulls first, label`;
  const courses = await tx<Course[]>`
    select c.id, c.key, c.label, c.category_id as "categoryId", cat.label as "categoryLabel", c.default_hours::float8 as "defaultHours",
           c.credential_type_id as "credentialTypeId", ct.label as "credentialLabel",
           (c.completion_rule->>'minHoursPct')::float8 as "minHoursPct", c.description, c.archived_at is not null as archived
    from training_courses c join training_categories cat on cat.id = c.category_id
    left join credential_types ct on ct.id = c.credential_type_id
    order by c.archived_at nulls first, cat.label, c.label`;
  const requirements = await tx<Requirement[]>`
    select r.id, r.label, r.category_id as "categoryId", cat.label as "categoryLabel", r.rank_id as "rankId", rk.label as "rankLabel",
           r.role_id as "roleId", ro.label as "roleLabel", r.required_hours::float8 as "requiredHours", r.span as window,
           r.effective_from::text as "effectiveFrom", r.effective_to::text as "effectiveTo", r.archived_at is not null as archived
    from training_requirements r join training_categories cat on cat.id = r.category_id
    left join ranks rk on rk.id = r.rank_id left join roles ro on ro.id = r.role_id
    order by r.archived_at nulls first, cat.label, r.label, r.effective_from desc`;
  const ranks = await tx<Option[]>`select id, label from ranks order by sort`;
  const roles = await tx<Option[]>`select id, label from roles order by label`;
  const credentialTypes = await tx<Option[]>`select id, label from credential_types where status = 'active' order by label`;
  return { categories: [...categories], courses: [...courses], requirements: [...requirements], ranks: [...ranks], roles: [...roles], credentialTypes: [...credentialTypes] };
}

export type SessionRow = {
  id: string; title: string; courseLabel: string; categoryLabel: string; startsAt: Date; endsAt: Date; tz: string;
  unitName: string | null; location: string | null; instructorName: string | null; instructorId: string | null;
  capacity: number | null; assignedOnly: boolean; durationHours: number; status: string; cancelledReason: string | null;
  notes: string | null; myStatus: string | null; credentialLabel: string | null;
};

const sessionSelect = (tx: Tx) => tx`
  s.id, s.title, c.label as "courseLabel", cat.label as "categoryLabel", s.starts_at as "startsAt", s.ends_at as "endsAt",
  coalesce(ou.timezone, t.timezone) as tz, ou.name as "unitName", s.location_text as location,
  i.last_name || ', ' || i.first_name as "instructorName", s.instructor_member_id as "instructorId",
  s.capacity, s.assigned_only as "assignedOnly", s.duration_hours::float8 as "durationHours", s.status, s.cancelled_reason as "cancelledReason",
  s.notes, (select e.status from training_enrollments e where e.session_id = s.id and e.member_id = app.my_member_id()) as "myStatus",
  ct.label as "credentialLabel"`;
const sessionFrom = (tx: Tx) => tx`
  from training_sessions s
  join training_courses c on c.id = s.course_id
  join training_categories cat on cat.id = c.category_id
  join tenants t on t.id = s.tenant_id
  left join org_units ou on ou.id = s.org_unit_id
  left join members i on i.id = s.instructor_member_id
  left join credential_types ct on ct.id = c.credential_type_id`;

/** Sessions visible to the caller that have not ended (plus recent ones for managers), soonest first. */
export async function loadUpcomingSessions(tx: Tx): Promise<SessionRow[]> {
  return [...(await tx<SessionRow[]>`
    select ${sessionSelect(tx)} ${sessionFrom(tx)}
    where s.status in ('draft', 'scheduled') and s.ends_at > now() - interval '1 day'
    order by s.starts_at limit 100`)];
}

/** Sessions the caller is enrolled in or has attended, newest first. */
export async function loadMySessions(tx: Tx): Promise<SessionRow[]> {
  return [...(await tx<SessionRow[]>`
    select ${sessionSelect(tx)} ${sessionFrom(tx)}
    where exists (select 1 from training_enrollments e where e.session_id = s.id and e.member_id = app.my_member_id() and e.status <> 'withdrawn')
    order by s.starts_at desc limit 50`)];
}

export async function loadSession(tx: Tx, id: string): Promise<SessionRow | null> {
  const [row] = await tx<SessionRow[]>`select ${sessionSelect(tx)} ${sessionFrom(tx)} where s.id = ${id}`;
  return row ?? null;
}

export type RosterRow = {
  enrollmentId: string; memberId: string; name: string; source: string; status: string;
  attendance: string | null; hours: number | null; note: string | null; markedAt: Date | null; awardKind: string | null; awardedAt: Date | null;
  changedAfterAward: boolean;
};

/** Who is enrolled, with their current attendance and award. Members only get their own row (RLS). */
export async function loadRoster(tx: Tx, sessionId: string): Promise<RosterRow[]> {
  return [...(await tx<RosterRow[]>`
    select e.id as "enrollmentId", e.member_id as "memberId", m.last_name || ', ' || m.first_name as name, e.source, e.status,
           a.status as attendance, a.hours::float8 as hours, a.note, a.marked_at as "markedAt", w.kind as "awardKind", w.awarded_at as "awardedAt",
           (w.awarded_at is not null and a.marked_at > w.awarded_at) as "changedAfterAward"
    from training_enrollments e
    join members m on m.id = e.member_id
    left join training_attendance_current a on a.enrollment_id = e.id
    left join training_awards w on w.session_id = e.session_id and w.member_id = e.member_id
    where e.session_id = ${sessionId} order by e.status, m.last_name, m.first_name`)];
}

export type MyHours = { categoryId: string; categoryLabel: string; hours: number };

/** The caller's hours this year by category. */
export async function loadMyHours(tx: Tx, tz: string): Promise<MyHours[]> {
  const year = localDateOf(new Date(), tz).slice(0, 4);
  return [...(await tx<MyHours[]>`
    select h.category_id as "categoryId", c.label as "categoryLabel", sum(h.hours)::float8 as hours
    from training_hours h join training_categories c on c.id = h.category_id
    where h.member_id = app.my_member_id() and h.credited_on >= ${`${year}-01-01`}::date
    group by h.category_id, c.label order by c.label`)];
}

export type AwardCandidate = { memberId: string; name: string; issuedOn: IsoDate; expiresOn: IsoDate | null };

/**
 * Who would be awarded the course credential if the session were completed now, with the issue and expiry dates the
 * server computes from the credential type's validity rule (the same rule the credentials pages use).
 */
export async function loadAwardCandidates(tx: Tx, sessionId: string, tz: string): Promise<{ credentialLabel: string | null; candidates: AwardCandidate[] }> {
  const [info] = await tx<{ typeId: string | null; label: string | null; validity: Validity | null; pct: number; duration: number; startsAt: Date }[]>`
    select c.credential_type_id as "typeId", ct.label, ct.validity, (c.completion_rule->>'minHoursPct')::float8 as pct,
           s.duration_hours::float8 as duration, s.starts_at as "startsAt"
    from training_sessions s join training_courses c on c.id = s.course_id left join credential_types ct on ct.id = c.credential_type_id
    where s.id = ${sessionId}`;
  if (!info || !info.typeId || !info.validity) return { credentialLabel: null, candidates: [] };
  const min = (info.pct / 100) * info.duration;
  const rows = await tx<{ memberId: string; name: string }[]>`
    select a.member_id as "memberId", m.last_name || ', ' || m.first_name as name
    from training_attendance_current a join members m on m.id = a.member_id
    where a.session_id = ${sessionId} and a.status in ('attended', 'partial') and a.hours >= ${min}
      and not exists (select 1 from training_awards w where w.session_id = a.session_id and w.member_id = a.member_id)
    order by m.last_name, m.first_name`;
  const issuedOn = localDateOf(info.startsAt, tz);
  return {
    credentialLabel: info.label,
    candidates: rows.map((r) => ({ memberId: r.memberId, name: r.name, issuedOn, expiresOn: credentialExpiry(info.validity!, issuedOn) })),
  };
}
