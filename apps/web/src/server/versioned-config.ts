import 'server-only';
import type { IsoDate } from '@soma/schedule-engine';
import { ActionError } from '@/server/errors';
import type { Tx } from '@/server/db';

/**
 * Versioned, effective-dated configuration documents (`config_versions`): a draft is edited freely,
 * approving it makes it effective from a local date and closes the previous version at that instant.
 * Used for shift patterns, leave accrual policies and pay rules.
 */
export type VersionRow<T> = {
  id: string;
  version: number;
  status: 'draft' | 'approved' | 'retired';
  /** Local (department time zone) calendar days; null for drafts and open ends. */
  fromDate: IsoDate | null;
  toDate: IsoDate | null;
  note: string | null;
  payload: T;
};

/** All versions of one document, newest first. */
export async function listVersions<T>(tx: Tx, kind: string, key: string): Promise<VersionRow<T>[]> {
  const rows = await tx<{ id: string; version: number; status: VersionRow<T>['status']; from_date: string | null; to_date: string | null; change_note: string | null; payload: T }[]>`
    select c.id, c.version, c.status, c.change_note, c.payload,
           case when c.status = 'draft' or lower_inf(c.effective) then null
                else (lower(c.effective) at time zone t.timezone)::date::text end as from_date,
           case when c.status = 'draft' or upper_inf(c.effective) then null
                else (upper(c.effective) at time zone t.timezone)::date::text end as to_date
    from config_versions c join tenants t on t.id = c.tenant_id
    where c.tenant_id = app.tenant_id() and c.kind = ${kind} and c.key = ${key}
    order by c.version desc`;
  return rows.map((r) => ({ id: r.id, version: r.version, status: r.status, fromDate: r.from_date, toDate: r.to_date, note: r.change_note, payload: r.payload }));
}

/** Updates the open draft, or creates draft version N+1. Returns the draft's version number. */
export async function saveDraft<T>(tx: Tx, kind: string, key: string, payload: T): Promise<number> {
  const [draft] = await tx<{ id: string; version: number }[]>`
    select id, version from config_versions
    where tenant_id = app.tenant_id() and kind = ${kind} and key = ${key} and status = 'draft'
    order by version desc limit 1 for update`;
  if (draft) {
    await tx`update config_versions set payload = ${tx.json(payload as never)} where id = ${draft.id}`;
    return draft.version;
  }
  const [next] = await tx<{ v: number }[]>`
    select coalesce(max(version), 0) + 1 as v from config_versions
    where tenant_id = app.tenant_id() and kind = ${kind} and key = ${key}`;
  await tx`insert into config_versions (tenant_id, kind, key, version, status, effective, payload)
           values (app.tenant_id(), ${kind}, ${key}, ${next!.v}, 'draft', tstzrange(null, null), ${tx.json(payload as never)})`;
  return next!.v;
}

/**
 * Approves draft `version` from local midnight of `effectiveDate` and closes the current approved
 * version at that instant. Past dates are allowed. The date must be after the current version's start.
 * Needs admin.config.manage (enforced by RLS).
 */
export async function approveDraft(tx: Tx, kind: string, key: string, version: number, effectiveDate: IsoDate, reason: string): Promise<void> {
  const [draft] = await tx<{ id: string }[]>`
    select id from config_versions
    where tenant_id = app.tenant_id() and kind = ${kind} and key = ${key} and status = 'draft' and version = ${version}
    for update`;
  if (!draft) throw new ActionError(`Draft v${version} no longer exists. Reload the page.`);

  const [{ tz } = { tz: '' }] = await tx<{ tz: string }[]>`select timezone as tz from tenants where id = app.tenant_id()`;
  const [current] = await tx<{ id: string; version: number; from_date: string | null }[]>`
    select c.id, c.version, case when lower_inf(c.effective) then null else (lower(c.effective) at time zone ${tz})::date::text end as from_date
    from config_versions c
    where c.tenant_id = app.tenant_id() and c.kind = ${kind} and c.key = ${key} and c.status = 'approved'
    order by lower(c.effective) desc nulls last limit 1
    for update`;
  if (current?.from_date && effectiveDate <= current.from_date) {
    throw new ActionError(`Choose a date after ${current.from_date}, when v${current.version} took effect.`);
  }

  await tx`select set_config('app.reason', ${reason}, true)`;
  if (current) {
    await tx`update config_versions set effective = tstzrange(lower(effective), ${effectiveDate}::timestamp at time zone ${tz})
             where id = ${current.id} and (upper_inf(effective) or upper(effective) > ${effectiveDate}::timestamp at time zone ${tz})`;
  }
  await tx`update config_versions set status = 'approved', effective = tstzrange(${effectiveDate}::timestamp at time zone ${tz}, null)
           where id = ${draft.id}`;
}

/** The approved version in force on a local calendar date, or null. */
export async function approvedOn<T>(tx: Tx, kind: string, key: string, date: IsoDate): Promise<{ version: number; payload: T } | null> {
  const [row] = await tx<{ version: number; payload: T }[]>`
    select c.version, c.payload
    from config_versions c join tenants t on t.id = c.tenant_id
    where c.tenant_id = app.tenant_id() and c.kind = ${kind} and c.key = ${key} and c.status = 'approved'
      and c.effective @> (${date}::date)::timestamp at time zone t.timezone
    limit 1`;
  return row ?? null;
}
