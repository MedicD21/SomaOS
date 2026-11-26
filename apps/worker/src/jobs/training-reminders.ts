import type postgres from 'postgres';
import {
  localDateOf, trainingCompliance,
  type IsoDate, type TrainingHours, type TrainingMember, type TrainingRequirement, type TrainingWindow,
} from '@soma/schedule-engine';
import { nextScanTime } from './credential-expiry-scan';

export const TRAINING_REMINDER_KIND = 'training-reminders';

/** Inserts a pending training-reminder job at `runAfter` unless one is already pending. */
export async function ensureTrainingReminderJob(sql: postgres.Sql, runAfter: Date): Promise<void> {
  await sql`insert into jobs (kind, payload, run_after)
            select ${TRAINING_REMINDER_KIND}, '{}'::jsonb, ${runAfter}
            where not exists (select 1 from jobs where kind = ${TRAINING_REMINDER_KIND} and status = 'pending')`;
}

type Tx = postgres.TransactionSql;
const HOURS_LOOKBACK_YEARS = 6;

/** Logs a reminder and notifies once: the unique log row makes a rerun send nothing. Returns true when it sent. */
async function notifyOnce(
  sql: postgres.Sql,
  tenant: string,
  member: string,
  kind: 'requirement' | 'session' | 'digest',
  refId: string,
  level: string,
  windowEnd: IsoDate | null,
  title: string,
  body: string,
  link: string,
): Promise<boolean> {
  return sql.begin(async (tx: Tx) => {
    const rows = await tx`
      insert into training_reminder_log (tenant_id, member_id, kind, ref_id, level, window_end)
      values (${tenant}, ${member}, ${kind}, ${refId}, ${level}, ${windowEnd})
      on conflict do nothing returning id`;
    if (rows.length === 0) return false;
    await tx`select app.notify_internal(${member}, 'training', ${title}, ${body}, ${link})`;
    return true;
  });
}

/**
 * Daily scan: requirement reminders (due soon, overdue), an officer digest of overdue members in their scope, and a
 * reminder to people enrolled in a session starting within 24 hours. Compliance uses the same pure rule as the web
 * page. Reschedules itself first so a failure cannot break the daily chain.
 */
export async function sendTrainingReminders(sql: postgres.Sql, now: Date): Promise<{ sent: number }> {
  await ensureTrainingReminderJob(sql, nextScanTime(now));
  let sent = 0;
  const failures: string[] = [];

  const tenants = await sql<{ id: string; timezone: string }[]>`
    select t.id, t.timezone from tenants t join tenant_settings s on s.tenant_id = t.id
    where t.status = 'active' and 'training' = any (s.enabled_modules)`;

  for (const t of tenants) {
    try {
      const today = localDateOf(now, t.timezone);
      sent += await requirementReminders(sql, t.id, today);
      sent += await sessionReminders(sql, t.id, now);
    } catch (e) {
      failures.push(`${t.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (failures.length > 0) throw new Error(`training reminders: ${failures.length} department(s) failed (${sent} sent): ${failures.join('; ')}`);
  return { sent };
}

async function requirementReminders(sql: postgres.Sql, tenant: string, today: IsoDate): Promise<number> {
  const requirements = (
    await sql<{ id: string; label: string; category_id: string; rank_id: string | null; role_id: string | null; required_hours: string; span: TrainingWindow; effective_from: string; effective_to: string | null }[]>`
      select id, label, category_id, rank_id, role_id, required_hours::text, span, effective_from::text, effective_to::text
      from training_requirements where tenant_id = ${tenant} and archived_at is null`
  ).map((r): TrainingRequirement => ({
    id: r.id, label: r.label, categoryId: r.category_id, rankId: r.rank_id, roleId: r.role_id, requiredHours: Number(r.required_hours),
    window: r.span, effectiveFrom: r.effective_from, effectiveTo: r.effective_to,
  }));
  if (requirements.length === 0) return 0;

  const members = (
    await sql<{ id: string; rank_id: string | null; roles: string[] }[]>`
      select m.id, m.rank_id, coalesce(array_agg(g.role_id) filter (where g.role_id is not null), '{}') as roles
      from members m left join role_grants g on g.member_id = m.id and g.valid @> now()
      where m.tenant_id = ${tenant} and m.status <> 'separated' group by m.id`
  ).map((m): TrainingMember => ({ id: m.id, rankId: m.rank_id, roleIds: m.roles }));

  const since = `${Number(today.slice(0, 4)) - HOURS_LOOKBACK_YEARS}-01-01`;
  const hours = (
    await sql<{ member_id: string; category_id: string; credited_on: string; hours: string }[]>`
      select member_id, category_id, credited_on::text, hours::text from training_hours
      where tenant_id = ${tenant} and credited_on >= ${since}::date`
  ).map((h): TrainingHours => ({ memberId: h.member_id, categoryId: h.category_id, creditedOn: h.credited_on, hours: Number(h.hours) }));

  const rows = trainingCompliance({ requirements, members, hours, today });
  let sent = 0;
  const labels = new Map(requirements.map((r) => [r.id, r.label]));
  for (const r of rows) {
    if (r.status !== 'due_soon' && r.status !== 'overdue') continue;
    const label = labels.get(r.requirementId) ?? 'Training';
    const title = r.status === 'overdue' ? `${label}: ${r.remaining} h short` : `${label}: ${r.remaining} h still needed by ${r.windowEnd}`;
    if (await notifyOnce(sql, tenant, r.memberId, 'requirement', r.requirementId, r.status, r.windowEnd, title, r.explain[0]?.message ?? title, '/training')) sent++;
  }

  // Officer digest: overdue members in each officer's scope, one notification per officer per day.
  const overdue = rows.filter((r) => r.status === 'overdue');
  if (overdue.length > 0) sent += await officerDigests(sql, tenant, today, overdue.map((r) => r.memberId));
  return sent;
}

async function officerDigests(sql: postgres.Sql, tenant: string, today: IsoDate, overdueMembers: string[]): Promise<number> {
  const grants = await sql<{ officer: string; kind: string; path: string | null }[]>`
    select g.member_id as officer, g.scope_kind as kind, ou.path::text as path
    from role_grants g
    join role_permissions rp on rp.role_id = g.role_id and rp.permission = 'training.compliance.view'
    left join org_units ou on ou.id = g.scope_org_unit_id
    where g.tenant_id = ${tenant} and g.valid @> now() and g.scope_kind in ('department', 'org_unit')`;
  if (grants.length === 0) return 0;
  const unitPath = new Map(
    (await sql<{ member_id: string; path: string }[]>`
      select a.member_id, ou.path::text as path from member_assignments a join org_units ou on ou.id = a.org_unit_id
      where a.tenant_id = ${tenant} and a.is_primary and a.effective @> current_date`).map((r) => [r.member_id, r.path]),
  );
  const byOfficer = new Map<string, Set<string>>();
  for (const g of grants) {
    for (const m of overdueMembers) {
      if (m === g.officer) continue;
      const p = unitPath.get(m);
      const inScope = g.kind === 'department' || (g.path !== null && p !== undefined && (p === g.path || p.startsWith(`${g.path}.`)));
      if (inScope) (byOfficer.get(g.officer) ?? byOfficer.set(g.officer, new Set()).get(g.officer)!).add(m);
    }
  }
  let sent = 0;
  for (const [officer, set] of byOfficer) {
    const n = set.size;
    const title = `${n} ${n === 1 ? 'member is' : 'members are'} overdue on required training`;
    if (await notifyOnce(sql, tenant, officer, 'digest', officer, today, null, title, 'Open the compliance page to see who and how many hours.', '/training/compliance')) sent++;
  }
  return sent;
}

async function sessionReminders(sql: postgres.Sql, tenant: string, now: Date): Promise<number> {
  const upcoming = await sql<{ session_id: string; member_id: string; title: string; starts_at: Date; timezone: string }[]>`
    select s.id as session_id, e.member_id, s.title, s.starts_at, t.timezone
    from training_sessions s
    join training_enrollments e on e.session_id = s.id and e.status = 'enrolled'
    join tenants t on t.id = s.tenant_id
    where s.tenant_id = ${tenant} and s.status = 'scheduled'
      and s.starts_at > ${now} and s.starts_at <= ${new Date(now.getTime() + 24 * 3_600_000)}`;
  let sent = 0;
  for (const u of upcoming) {
    const when = new Intl.DateTimeFormat('en-US', { timeZone: u.timezone, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(u.starts_at);
    if (await notifyOnce(sql, tenant, u.member_id, 'session', u.session_id, '24h', null, `Training tomorrow: ${u.title}`, `Starts ${when}.`, `/training/${u.session_id}`)) sent++;
  }
  return sent;
}
