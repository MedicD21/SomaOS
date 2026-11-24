import 'server-only';
import type { AccrualPolicy, IsoDate } from '@soma/schedule-engine';
import { ActionError } from '@/server/errors';
import type { Tx } from '@/server/db';

export const POLICY_KIND = 'leave.accrual';

export type PolicyVersion = {
  id: string;
  version: number;
  status: 'draft' | 'approved' | 'retired';
  fromDate: IsoDate | null;
  toDate: IsoDate | null;
  note: string | null;
  payload: AccrualPolicy;
};

/** Shown to admins who start a policy from scratch; every number is theirs to change. */
export const BLANK_POLICY: AccrualPolicy = {
  period: { kind: 'monthly' },
  tiers: [{ fromYears: 0, earn: { method: 'per_period', hours: 0 } }],
  cap: null,
  waitingPeriodDays: 0,
  prorateFirstPeriod: true,
  fractionByEmploymentType: {},
  negativeAllowed: false,
  carryover: { max: null, resetOn: null },
};

/** All versions of a bank's accrual policy, newest first. Dates are local (tenant timezone) calendar days. */
export async function listPolicyVersions(tx: Tx, bankKey: string): Promise<PolicyVersion[]> {
  const rows = await tx<{ id: string; version: number; status: PolicyVersion['status']; from_date: string | null; to_date: string | null; change_note: string | null; payload: AccrualPolicy }[]>`
    select c.id, c.version, c.status, c.change_note, c.payload,
           case when c.status = 'draft' or lower_inf(c.effective) then null
                else (lower(c.effective) at time zone t.timezone)::date::text end as from_date,
           case when c.status = 'draft' or upper_inf(c.effective) then null
                else (upper(c.effective) at time zone t.timezone)::date::text end as to_date
    from config_versions c join tenants t on t.id = c.tenant_id
    where c.tenant_id = app.tenant_id() and c.kind = ${POLICY_KIND} and c.key = ${bankKey}
    order by c.version desc`;
  return rows.map((r) => ({ id: r.id, version: r.version, status: r.status, fromDate: r.from_date, toDate: r.to_date, note: r.change_note, payload: r.payload }));
}

/** Updates the open draft, or creates draft version N+1. Returns the draft's version number. */
export async function savePolicyDraft(tx: Tx, bankKey: string, payload: AccrualPolicy): Promise<number> {
  const [draft] = await tx<{ id: string; version: number }[]>`
    select id, version from config_versions
    where tenant_id = app.tenant_id() and kind = ${POLICY_KIND} and key = ${bankKey} and status = 'draft'
    order by version desc limit 1 for update`;
  if (draft) {
    await tx`update config_versions set payload = ${tx.json(payload as never)} where id = ${draft.id}`;
    return draft.version;
  }
  const [next] = await tx<{ v: number }[]>`
    select coalesce(max(version), 0) + 1 as v from config_versions
    where tenant_id = app.tenant_id() and kind = ${POLICY_KIND} and key = ${bankKey}`;
  await tx`insert into config_versions (tenant_id, kind, key, version, status, effective, payload)
           values (app.tenant_id(), ${POLICY_KIND}, ${bankKey}, ${next!.v}, 'draft', tstzrange(null, null), ${tx.json(payload as never)})`;
  return next!.v;
}

/**
 * Approves draft `version` from local midnight of `effectiveDate` (department time zone) and closes
 * the current approved version at that instant. Past dates are allowed: the accrual job then posts
 * every completed period since that date (up to two years back). Needs admin.config.manage.
 */
export async function approvePolicyDraft(tx: Tx, bankKey: string, version: number, effectiveDate: IsoDate): Promise<void> {
  const [draft] = await tx<{ id: string }[]>`
    select id from config_versions
    where tenant_id = app.tenant_id() and kind = ${POLICY_KIND} and key = ${bankKey} and status = 'draft' and version = ${version}
    for update`;
  if (!draft) throw new ActionError(`Draft v${version} no longer exists. Reload the page.`);

  const [{ tz } = { tz: '' }] = await tx<{ tz: string }[]>`select timezone as tz from tenants where id = app.tenant_id()`;
  const [current] = await tx<{ id: string; version: number; from_date: string | null }[]>`
    select c.id, c.version, case when lower_inf(c.effective) then null else (lower(c.effective) at time zone ${tz})::date::text end as from_date
    from config_versions c
    where c.tenant_id = app.tenant_id() and c.kind = ${POLICY_KIND} and c.key = ${bankKey} and c.status = 'approved'
    order by lower(c.effective) desc nulls last limit 1
    for update`;
  if (current?.from_date && effectiveDate <= current.from_date) {
    throw new ActionError(`Choose a date after ${current.from_date}, when v${current.version} took effect.`);
  }

  await tx`select set_config('app.reason', ${`Leave policy ${bankKey} v${version} approved effective ${effectiveDate}`}, true)`;
  if (current) {
    await tx`update config_versions set effective = tstzrange(lower(effective), ${effectiveDate}::timestamp at time zone ${tz})
             where id = ${current.id} and (upper_inf(effective) or upper(effective) > ${effectiveDate}::timestamp at time zone ${tz})`;
  }
  await tx`update config_versions set status = 'approved', effective = tstzrange(${effectiveDate}::timestamp at time zone ${tz}, null)
           where id = ${draft.id}`;
}
