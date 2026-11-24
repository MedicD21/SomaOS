import type postgres from 'postgres';
import { accrualPeriods, addDays, earnForPeriod, localDateOf, yearEndCarryover } from '@soma/schedule-engine';
import type { AccrualPolicy } from '@soma/schedule-engine';
import { accrualPolicySchema } from '@soma/validators';
import { nextScanTime } from './credential-expiry-scan';

export const ACCRUAL_KIND = 'leave-accrual';
/** How far back a run looks for unposted periods (two years), so an outage self-heals. */
const LOOKBACK_DAYS = 731;

type Version = {
  tenant_id: string;
  version: number;
  payload: unknown;
  bank_id: string;
  bank_key: string;
  timezone: string;
  from_date: string | null;
  to_date: string | null;
};
type Member = { id: string; hire_date: string | null; employment_type: string; separated_on: string | null };

/** Inserts a pending accrual job at `runAfter` unless one is already pending. */
export async function ensureAccrualJob(sql: postgres.Sql, runAfter: Date): Promise<void> {
  await sql`insert into jobs (kind, payload, run_after)
            select ${ACCRUAL_KIND}, '{}'::jsonb, ${runAfter}
            where not exists (select 1 from jobs where kind = ${ACCRUAL_KIND} and status = 'pending')`;
}

const validDate = (d: string): boolean => new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

async function balanceThrough(sql: postgres.Sql, v: Version, member: string, onOrBefore: string): Promise<number> {
  const [r] = await sql<{ b: number }[]>`
    select coalesce(sum(hours), 0)::float8 as b from leave_ledger
    where tenant_id = ${v.tenant_id} and member_id = ${member} and bank_id = ${v.bank_id} and effective_date <= ${onOrBefore}::date`;
  return r!.b;
}

async function hoursWorked(sql: postgres.Sql, v: Version, member: string, start: string, endExclusive: string, now: Date): Promise<number> {
  const [r] = await sql<{ h: number }[]>`
    select coalesce(sum(round(extract(epoch from ((upper(a.during) at time zone z.tz) - (lower(a.during) at time zone z.tz))) / 3600.0, 2)), 0)::float8 as h
    from shift_assignments a
    cross join lateral (
      select coalesce(ou.timezone, t.timezone) as tz
      from tenants t left join seats s on s.id = a.seat_id left join org_units ou on ou.id = s.org_unit_id
      where t.id = a.tenant_id) z
    where a.tenant_id = ${v.tenant_id} and a.member_id = ${member} and a.status = 'scheduled' and a.type <> 'kelly'
      and upper(a.during) <= ${now}
      and (lower(a.during) at time zone z.tz)::date >= ${start}::date
      and (lower(a.during) at time zone z.tz)::date < ${endExclusive}::date`;
  return r!.h;
}

async function accrueMember(
  sql: postgres.Sql, v: Version, policy: AccrualPolicy, m: Member, winStart: string, winEnd: string, usesHours: boolean, now: Date,
): Promise<number> {
  const from = m.hire_date && m.hire_date > winStart ? m.hire_date : winStart;
  const periods = accrualPeriods(policy.period, from, winEnd).filter((p) => p.start >= winStart && p.endExclusive <= winEnd);
  if (periods.length === 0) return 0;
  const done = new Set(
    (await sql<{ run_key: string }[]>`
      select run_key from leave_ledger
      where tenant_id = ${v.tenant_id} and member_id = ${m.id} and bank_id = ${v.bank_id} and run_key like 'earn:%'`).map((r) => r.run_key),
  );
  let posted = 0;
  for (const p of periods) {
    const key = `earn:${p.start}`;
    if (done.has(key)) continue;
    const lastDay = addDays(p.endExclusive, -1);
    const result = earnForPeriod(
      policy,
      {
        hireDate: m.hire_date,
        employmentType: m.employment_type,
        hoursWorked: usesHours ? await hoursWorked(sql, v, m.id, p.start, p.endExclusive, now) : 0,
        balance: await balanceThrough(sql, v, m.id, lastDay),
        separatedOn: m.separated_on,
      },
      p,
    );
    if (result.hours <= 0) continue;
    const ins = await sql`
      insert into leave_ledger (tenant_id, member_id, bank_id, kind, hours, effective_date, run_key, policy_version, note, explain)
      values (${v.tenant_id}, ${m.id}, ${v.bank_id}, 'earn', ${result.hours}, ${lastDay}::date, ${key}, ${v.version},
              ${`Accrual ${p.start} to ${lastDay}`}, ${sql.json(result.explain as never)})
      on conflict (tenant_id, member_id, bank_id, run_key) where run_key is not null do nothing
      returning id`;
    posted += ins.length;
  }
  return posted;
}

/** Forfeits hours above the carryover max on each reset date that has passed. */
async function expireMember(sql: postgres.Sql, v: Version, policy: AccrualPolicy, m: Member, winStart: string, today: string): Promise<number> {
  const { max, resetOn } = policy.carryover;
  if (max === null || !resetOn) return 0;
  let expired = 0;
  for (let year = Number(winStart.slice(0, 4)); year <= Number(today.slice(0, 4)); year++) {
    const boundary = `${year}-${resetOn}`;
    if (!validDate(boundary) || boundary < winStart || boundary > today) continue;
    if (v.from_date && boundary < v.from_date) continue;
    if (v.to_date && boundary >= v.to_date) continue;
    if (m.hire_date && m.hire_date >= boundary) continue;
    const key = `expire:${boundary}`;
    const [exists] = await sql`select 1 from leave_ledger where tenant_id = ${v.tenant_id} and member_id = ${m.id}
                               and bank_id = ${v.bank_id} and run_key = ${key}`;
    if (exists) continue;
    const balance = await balanceThrough(sql, v, m.id, addDays(boundary, -1));
    const result = yearEndCarryover(policy, balance);
    if (result.expired <= 0) continue;
    const ins = await sql`
      insert into leave_ledger (tenant_id, member_id, bank_id, kind, hours, effective_date, run_key, policy_version, note, explain)
      values (${v.tenant_id}, ${m.id}, ${v.bank_id}, 'expire', ${-result.expired}, ${boundary}::date, ${key}, ${v.version},
              ${`Carryover limit at ${boundary}`}, ${sql.json(result.explain as never)})
      on conflict (tenant_id, member_id, bank_id, run_key) where run_key is not null do nothing
      returning id`;
    expired += ins.length;
  }
  return expired;
}

/**
 * Posts accruals and carryover expirations for every approved leave policy, using each tenant's
 * local date. Idempotent (run keys), uses the policy version effective for each period, and one
 * failing member never blocks the others — failures are reported at the end.
 */
export async function runAccruals(sql: postgres.Sql, now: Date): Promise<{ posted: number; expired: number }> {
  // Enqueue the next run first so a failure below can never break the daily chain.
  await ensureAccrualJob(sql, nextScanTime(now));

  const versions = await sql<Version[]>`
    select c.tenant_id, c.version, c.payload, b.id as bank_id, b.key as bank_key, tn.timezone,
           case when lower_inf(c.effective) then null else (lower(c.effective) at time zone tn.timezone)::date::text end as from_date,
           case when upper_inf(c.effective) then null else (upper(c.effective) at time zone tn.timezone)::date::text end as to_date
    from config_versions c
    join leave_banks b on b.tenant_id = c.tenant_id and b.key = c.key and b.archived_at is null
    join tenants tn on tn.id = c.tenant_id and tn.status = 'active'
    where c.kind = 'leave.accrual' and c.status = 'approved'
    order by c.tenant_id, b.key, c.version`;

  const membersByTenant = new Map<string, Member[]>();
  let posted = 0;
  let expired = 0;
  const failures: string[] = [];

  for (const v of versions) {
    const parsed = accrualPolicySchema.safeParse(v.payload);
    if (!parsed.success) {
      failures.push(`policy ${v.bank_key} v${v.version} (${v.tenant_id}) is invalid`);
      continue;
    }
    const policy = parsed.data as AccrualPolicy;
    const today = localDateOf(now, v.timezone);
    const lookback = addDays(today, -LOOKBACK_DAYS);
    const winStart = v.from_date && v.from_date > lookback ? v.from_date : lookback;
    const winEnd = v.to_date && v.to_date < today ? v.to_date : today;
    if (winStart >= winEnd) continue;

    let members = membersByTenant.get(v.tenant_id);
    if (!members) {
      members = await sql<Member[]>`
        select id, hire_date::text as hire_date, employment_type, separated_on::text as separated_on
        from members where tenant_id = ${v.tenant_id} and status <> 'separated'`;
      membersByTenant.set(v.tenant_id, members);
    }
    const usesHours = policy.tiers.some((t) => t.earn.method === 'per_hours_worked');

    for (const m of members) {
      try {
        posted += await accrueMember(sql, v, policy, m, winStart, winEnd, usesHours, now);
        expired += await expireMember(sql, v, policy, m, winStart, today);
      } catch (e) {
        failures.push(`${v.bank_key}/${m.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`leave accrual: ${failures.length} item(s) failed (${posted} posted, ${expired} expired): ${failures.join('; ')}`);
  }
  return { posted, expired };
}
