import 'server-only';
import {
  addDays,
  evaluateStaffing,
  localPlusHoursToInstant,
  localToInstant,
  memberGroups,
  startOfLocalDay,
  suggestTransfers,
  type IsoDate,
  type OnDuty,
  type StaffingEvaluation,
  type StaffingRules,
  type StaffingWindow,
  type TransferSuggestion,
} from '@soma/schedule-engine';
import type { Tx } from '@/server/db';
import { ActionError } from '@/server/errors';
import { loadPatterns, loadSeats } from './load';

export const STAFFING_KIND = 'staffing.rules';
export const STAFFING_KEY = 'default';

export type StaffingDay = {
  rules: StaffingRules;
  window: StaffingWindow;
  evaluation: StaffingEvaluation;
  transfers: TransferSuggestion[];
};

async function tenantTz(tx: Tx): Promise<string> {
  const [row] = await tx<{ tz: string }[]>`select timezone as tz from tenants where id = app.tenant_id()`;
  return row!.tz;
}

/** The approved staffing rules in force at local midnight of `date`, or null when none are approved. */
export async function loadStaffingRules(tx: Tx, date: IsoDate): Promise<StaffingRules | null> {
  const at = startOfLocalDay(date, await tenantTz(tx)).toISOString();
  const [row] = await tx<{ payload: StaffingRules }[]>`
    select payload from config_versions
    where tenant_id = app.tenant_id() and kind = ${STAFFING_KIND} and key = ${STAFFING_KEY} and status = 'approved'
      and effective @> ${at}::timestamptz
    limit 1`;
  return row?.payload ?? null;
}

/** Credential type keys each member holds, with expiry, for staffing group membership. */
export async function loadCredentialKeys(tx: Tx, memberIds: string[]): Promise<Map<string, { key: string; expiresOn: IsoDate | null }[]>> {
  const out = new Map<string, { key: string; expiresOn: IsoDate | null }[]>();
  if (memberIds.length === 0) return out;
  const rows = await tx<{ member_id: string; key: string; expires_on: string | null }[]>`
    select q.member_id, ct.key, q.expires_on::text as expires_on
    from app.member_qualifications(${memberIds}::uuid[]) q
    join credential_types ct on ct.id = q.type_id`;
  for (const r of rows) {
    const list = out.get(r.member_id) ?? [];
    list.push({ key: r.key, expiresOn: r.expires_on });
    out.set(r.member_id, list);
  }
  return out;
}

/**
 * The operational day checked for `date`: 24 hours from the shift pattern's start time (local),
 * or from midnight when no pattern is approved.
 */
export async function staffingWindow(tx: Tx, date: IsoDate): Promise<StaffingWindow> {
  const tz = await tenantTz(tx);
  const dayEnd = startOfLocalDay(addDays(date, 1), tz).getTime();
  const shiftStart = (await loadPatterns(tx)).filter((p) => p.effectiveFrom.getTime() < dayEnd).at(-1)?.payload.shiftStart ?? '00:00';
  return { start: localToInstant(date, shiftStart, tz), end: localPlusHoursToInstant(date, shiftStart, 24, tz), tz };
}

/**
 * Staffing for one operational day across the whole department, moment by moment: every seated,
 * scheduled shift overlapping the window counts while it is on (split seats and the previous
 * day's crew included). Null when the department has no approved staffing rules.
 */
export async function evaluateStaffingDay(tx: Tx, date: IsoDate): Promise<StaffingDay | null> {
  const rules = await loadStaffingRules(tx, date);
  if (!rules) return null;
  const window = await staffingWindow(tx, date);

  const units = await tx<{ id: string; name: string; type_key: string }[]>`
    select ou.id, ou.name, t.key as type_key
    from org_units ou join org_unit_types t on t.id = ou.type_id
    where ou.tenant_id = app.tenant_id() and ou.status = 'active'
      and exists (select 1 from seats s where s.org_unit_id = ou.id and s.status = 'active')
    order by ou.path`;
  const seats = await loadSeats(tx, {});
  const seatById = new Map(seats.map((s) => [s.id, s]));
  const rows = await tx<{ seat_id: string; member_id: string; name: string; start: Date; end: Date }[]>`
    select a.seat_id, a.member_id, m.first_name || ' ' || m.last_name as name, lower(a.during) as start, upper(a.during) as "end"
    from shift_assignments a join members m on m.id = a.member_id
    where a.tenant_id = app.tenant_id() and a.status = 'scheduled' and a.seat_id is not null
      and a.during && tstzrange(${window.start.toISOString()}::timestamptz, ${window.end.toISOString()}::timestamptz)
    order by lower(a.during)`;
  const creds = await loadCredentialKeys(tx, [...new Set(rows.map((r) => r.member_id))]);

  const onDuty: OnDuty[] = rows
    .filter((r) => seatById.has(r.seat_id))
    .map((r) => {
      const seat = seatById.get(r.seat_id)!;
      return {
        memberId: r.member_id,
        memberName: r.name,
        unitId: seat.orgUnitId,
        seatId: seat.id,
        seatLabel: seat.label,
        seatSort: seat.sort,
        seatHasMinRank: seat.rule.minRankSort !== null,
        groups: memberGroups(rules, creds.get(r.member_id) ?? [], r.end, seat.tz),
        start: r.start,
        end: r.end,
      };
    });
  const staffingUnits = units.map((u) => ({ id: u.id, name: u.name, typeKey: u.type_key }));
  return {
    rules,
    window,
    evaluation: evaluateStaffing(rules, staffingUnits, onDuty, window),
    transfers: suggestTransfers(rules, staffingUnits, onDuty, window),
  };
}

export type StaffingVersion = { id: string; version: number; status: 'draft' | 'approved' | 'retired'; fromDate: IsoDate | null; payload: StaffingRules };

/** All versions of the department's staffing rules, newest first. */
export async function listStaffingVersions(tx: Tx): Promise<StaffingVersion[]> {
  const rows = await tx<{ id: string; version: number; status: StaffingVersion['status']; from_date: string | null; payload: StaffingRules }[]>`
    select c.id, c.version, c.status,
           case when c.status = 'draft' or lower_inf(c.effective) then null
                else (lower(c.effective) at time zone t.timezone)::date::text end as from_date,
           c.payload
    from config_versions c join tenants t on t.id = c.tenant_id
    where c.tenant_id = app.tenant_id() and c.kind = ${STAFFING_KIND} and c.key = ${STAFFING_KEY}
    order by c.version desc`;
  return rows.map((r) => ({ id: r.id, version: r.version, status: r.status, fromDate: r.from_date, payload: r.payload }));
}

/** Updates the open draft or creates draft N+1. Returns the draft's version number. */
export async function saveStaffingDraft(tx: Tx, payload: StaffingRules): Promise<number> {
  const [draft] = await tx<{ id: string; version: number }[]>`
    select id, version from config_versions
    where tenant_id = app.tenant_id() and kind = ${STAFFING_KIND} and key = ${STAFFING_KEY} and status = 'draft'
    order by version desc limit 1 for update`;
  if (draft) {
    await tx`update config_versions set payload = ${tx.json(payload as never)} where id = ${draft.id}`;
    return draft.version;
  }
  const [next] = await tx<{ v: number }[]>`
    select coalesce(max(version), 0) + 1 as v from config_versions
    where tenant_id = app.tenant_id() and kind = ${STAFFING_KIND} and key = ${STAFFING_KEY}`;
  await tx`insert into config_versions (tenant_id, kind, key, version, status, effective, payload)
           values (app.tenant_id(), ${STAFFING_KIND}, ${STAFFING_KEY}, ${next!.v}, 'draft', tstzrange(null, null), ${tx.json(payload as never)})`;
  return next!.v;
}

/**
 * Approves draft `version` from local midnight of `effectiveDate`, closing the version in force then.
 * Caller must hold admin.config.manage (RLS re-checks it).
 */
export async function approveStaffingDraft(tx: Tx, version: number, effectiveDate: IsoDate, today: IsoDate): Promise<void> {
  if (effectiveDate < today) throw new ActionError('The effective date cannot be in the past.');
  const [draft] = await tx<{ id: string }[]>`
    select id from config_versions
    where tenant_id = app.tenant_id() and kind = ${STAFFING_KIND} and key = ${STAFFING_KEY} and status = 'draft' and version = ${version}
    for update`;
  if (!draft) throw new ActionError(`Draft v${version} no longer exists. Reload the page.`);
  const tz = await tenantTz(tx);
  const [current] = await tx<{ id: string; version: number; from_date: string | null }[]>`
    select c.id, c.version, case when lower_inf(c.effective) then null else (lower(c.effective) at time zone ${tz})::date::text end as from_date
    from config_versions c
    where c.tenant_id = app.tenant_id() and c.kind = ${STAFFING_KIND} and c.key = ${STAFFING_KEY} and c.status = 'approved'
    order by lower(c.effective) desc nulls last limit 1
    for update`;
  if (current?.from_date && effectiveDate <= current.from_date) {
    throw new ActionError(`Choose a date after ${current.from_date}, when v${current.version} took effect.`);
  }
  await tx`select set_config('app.reason', ${`Staffing rules v${version} approved effective ${effectiveDate}`}, true)`;
  if (current) {
    await tx`update config_versions set effective = tstzrange(lower(effective), ${effectiveDate}::timestamp at time zone ${tz})
             where id = ${current.id} and (upper_inf(effective) or upper(effective) > ${effectiveDate}::timestamp at time zone ${tz})`;
  }
  await tx`update config_versions set status = 'approved', effective = tstzrange(${effectiveDate}::timestamp at time zone ${tz}, null)
           where id = ${draft.id}`;
}
