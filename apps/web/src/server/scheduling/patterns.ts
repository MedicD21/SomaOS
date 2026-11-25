import 'server-only';
import type { IsoDate, ShiftPattern } from '@soma/schedule-engine';
import { ActionError } from '@/server/errors';
import type { Tx } from '@/server/db';
import { supersedeGenerated } from './generate';

/** Generation assumes one pattern key per department. */
export const PATTERN_KIND = 'schedule.pattern';
export const PATTERN_KEY = 'default';

export type PatternVersion = {
  id: string;
  version: number;
  status: 'draft' | 'approved' | 'retired';
  /** Local (tenant timezone) first and last effective dates; null when unbounded or a draft. */
  fromDate: IsoDate | null;
  toDate: IsoDate | null;
  payload: ShiftPattern;
};

/** All versions of the department pattern, newest first. */
export async function listPatternVersions(tx: Tx): Promise<PatternVersion[]> {
  const rows = await tx<{ id: string; version: number; status: PatternVersion['status']; from_date: string | null; to_date: string | null; payload: ShiftPattern }[]>`
    select c.id, c.version, c.status,
           case when c.status = 'draft' or lower_inf(c.effective) then null
                else (lower(c.effective) at time zone t.timezone)::date::text end as from_date,
           case when c.status = 'draft' or upper_inf(c.effective) then null
                else ((upper(c.effective) at time zone t.timezone)::date - 1)::text end as to_date,
           c.payload
    from config_versions c join tenants t on t.id = c.tenant_id
    where c.tenant_id = app.tenant_id() and c.kind = ${PATTERN_KIND} and c.key = ${PATTERN_KEY}
    order by c.version desc`;
  return rows.map((r) => ({ id: r.id, version: r.version, status: r.status, fromDate: r.from_date, toDate: r.to_date, payload: r.payload }));
}

/** Updates the open draft, or creates draft version N+1. Returns the draft's version number. */
export async function savePatternDraft(tx: Tx, payload: ShiftPattern): Promise<number> {
  const [draft] = await tx<{ id: string; version: number }[]>`
    select id, version from config_versions
    where tenant_id = app.tenant_id() and kind = ${PATTERN_KIND} and key = ${PATTERN_KEY} and status = 'draft'
    order by version desc limit 1 for update`;
  if (draft) {
    await tx`update config_versions set payload = ${tx.json(payload as never)} where id = ${draft.id}`;
    return draft.version;
  }
  const [next] = await tx<{ v: number }[]>`
    select coalesce(max(version), 0) + 1 as v from config_versions
    where tenant_id = app.tenant_id() and kind = ${PATTERN_KIND} and key = ${PATTERN_KEY}`;
  // A draft's range is irrelevant (only approved rows are exclusive); approval sets it.
  await tx`insert into config_versions (tenant_id, kind, key, version, status, effective, payload)
           values (app.tenant_id(), ${PATTERN_KIND}, ${PATTERN_KEY}, ${next!.v}, 'draft', tstzrange(null, null), ${tx.json(payload as never)})`;
  return next!.v;
}

/**
 * Approves draft `version` from local midnight of `effectiveDate` (tenant timezone): closes the
 * current approved version at that instant and supersedes generated, still-scheduled shifts that
 * start on or after that local date (they follow the old pattern; regeneration recreates them).
 * Caller must hold admin.config.manage and department-wide scheduling.roster.edit.
 */
export async function approvePatternDraft(
  tx: Tx,
  version: number,
  effectiveDate: IsoDate,
  today: IsoDate,
  note = '',
): Promise<{ superseded: number }> {
  const [draft] = await tx<{ id: string }[]>`
    select id from config_versions
    where tenant_id = app.tenant_id() and kind = ${PATTERN_KIND} and key = ${PATTERN_KEY}
      and status = 'draft' and version = ${version}
    for update`;
  if (!draft) throw new ActionError(`Draft v${version} no longer exists. Reload the page.`);

  const [{ tz } = { tz: '' }] = await tx<{ tz: string }[]>`select timezone as tz from tenants where id = app.tenant_id()`;
  const [current] = await tx<{ id: string; version: number; from_date: string | null }[]>`
    select c.id, c.version, case when lower_inf(c.effective) then null else (lower(c.effective) at time zone ${tz})::date::text end as from_date
    from config_versions c
    where c.tenant_id = app.tenant_id() and c.kind = ${PATTERN_KIND} and c.key = ${PATTERN_KEY} and c.status = 'approved'
    order by lower(c.effective) desc nulls last limit 1
    for update`;
  if (current?.from_date && effectiveDate <= current.from_date) {
    throw new ActionError(`Choose a date after ${current.from_date}, when v${current.version} took effect.`);
  }
  if (effectiveDate < today) throw new ActionError('The effective date cannot be in the past.');

  await tx`select set_config('app.reason', ${`Pattern v${version} approved effective ${effectiveDate}.${note}`}, true)`;
  if (current) {
    await tx`update config_versions set effective = tstzrange(lower(effective), ${effectiveDate}::timestamp at time zone ${tz})
             where id = ${current.id} and (upper_inf(effective) or upper(effective) > ${effectiveDate}::timestamp at time zone ${tz})`;
  }
  await tx`update config_versions set status = 'approved', effective = tstzrange(${effectiveDate}::timestamp at time zone ${tz}, null)
           where id = ${draft.id}`;

  return { superseded: await supersedeGenerated(tx, effectiveDate, { reason: null }) };
}
