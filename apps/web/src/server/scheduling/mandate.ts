import 'server-only';
import {
  addDays,
  checkQualification,
  mandateCandidates,
  memberGroups,
  startOfLocalDay,
  type IsoDate,
  type MandateCandidate,
  type StaffingRules,
} from '@soma/schedule-engine';
import type { Tx } from '@/server/db';
import { loadMemberQuals, loadSeats } from './load';
import { loadCredentialKeys } from './staffing';

export type MandateListSummary = { id: string; name: string; size: number };

export type MandateEntryView = MandateCandidate & { exemptReason: string | null; exemptUntil: IsoDate | null };

export type MandateEventView = {
  id: string;
  kind: string;
  memberName: string | null;
  reason: string | null;
  onDate: IsoDate | null;
  by: string | null;
  at: Date;
};

export async function listMandateLists(tx: Tx): Promise<MandateListSummary[]> {
  return [
    ...(await tx<MandateListSummary[]>`
      select l.id, l.name,
             (select count(*)::int from mandate_list_entries e where e.list_id = l.id and e.status = 'active') as size
      from mandate_lists l
      where l.tenant_id = app.tenant_id() and l.status = 'active'
      order by l.name`),
  ];
}

/**
 * The list in order with each member's status for `date`: exempt, already working that day, on
 * leave, skipped for the date, separated, or not in the staffing group `group` (when rules exist).
 * The first `eligible` entry is next up.
 */
export async function loadMandateEntries(
  tx: Tx,
  listId: string,
  date: IsoDate,
  rules: StaffingRules | null,
  group: string | null,
): Promise<MandateEntryView[]> {
  const entries = await tx<
    { member_id: string; name: string; position: number; exempt_reason: string | null; exempt_until: string | null; separated: boolean }[]
  >`
    select e.member_id, m.last_name || ', ' || m.first_name as name, e.position, e.exempt_reason, e.exempt_until::text as exempt_until,
           (m.status = 'separated' or m.separated_on <= ${date}::date) as separated
    from mandate_list_entries e join members m on m.id = e.member_id
    where e.list_id = ${listId} and e.status = 'active'
    order by e.position`;
  const ids = entries.map((e) => e.member_id);
  if (ids.length === 0) return [];

  const [{ tz } = { tz: 'UTC' }] = await tx<{ tz: string }[]>`select timezone as tz from tenants where id = app.tenant_id()`;
  const lo = startOfLocalDay(date, tz).toISOString();
  const hi = startOfLocalDay(addDays(date, 1), tz).toISOString();
  const working = await tx<{ member_id: string }[]>`
    select distinct member_id from shift_assignments
    where tenant_id = app.tenant_id() and member_id = any (${ids}::uuid[]) and status = 'scheduled' and type <> 'kelly'
      and during && tstzrange(${lo}::timestamptz, ${hi}::timestamptz)`;
  const onLeave = await tx<{ member_id: string }[]>`
    select distinct member_id from leave_requests
    where tenant_id = app.tenant_id() and member_id = any (${ids}::uuid[]) and status in ('pending', 'approved')
      and ${date}::date between start_date and end_date`;
  const skipped = await tx<{ member_id: string }[]>`
    select distinct member_id from mandate_events
    where list_id = ${listId} and kind = 'skipped' and on_date = ${date}::date`;

  let qualified = new Set(ids);
  if (rules && group) {
    // A mandated shift starting that day runs into the next; credentials must last through it.
    const shiftEnd = startOfLocalDay(addDays(date, 2), tz);
    const creds = await loadCredentialKeys(tx, ids);
    qualified = new Set(ids.filter((id) => memberGroups(rules, creds.get(id) ?? [], shiftEnd, tz).includes(group)));
  }

  const candidates = mandateCandidates(
    entries.map((e) => ({ memberId: e.member_id, name: e.name, position: e.position, exemptReason: e.exempt_reason, exemptUntil: e.exempt_until })),
    {
      date,
      working: new Set(working.map((r) => r.member_id)),
      onLeave: new Set(onLeave.map((r) => r.member_id)),
      qualified,
      separated: new Set(entries.filter((e) => e.separated).map((e) => e.member_id)),
      skipped: new Set(skipped.map((r) => r.member_id)),
    },
  );
  const byId = new Map(entries.map((e) => [e.member_id, e]));
  return candidates.map((c) => ({ ...c, exemptReason: byId.get(c.memberId)!.exempt_reason, exemptUntil: byId.get(c.memberId)!.exempt_until }));
}

export async function loadMandateHistory(tx: Tx, listId: string, limit = 30): Promise<MandateEventView[]> {
  const rows = await tx<
    { id: string; kind: string; member_name: string | null; reason: string | null; on_date: string | null; by: string | null; at: Date }[]
  >`
    select ev.id, ev.kind, m.first_name || ' ' || m.last_name as member_name, ev.reason, ev.on_date::text as on_date,
           (select a.first_name || ' ' || a.last_name from members a
             where a.tenant_id = ev.tenant_id and a.user_id = ev.created_by limit 1) as by,
           ev.created_at as at
    from mandate_events ev left join members m on m.id = ev.member_id
    where ev.list_id = ${listId}
    order by ev.created_at desc, ev.id desc
    limit ${limit}`;
  return rows.map((r) => ({ id: r.id, kind: r.kind, memberName: r.member_name, reason: r.reason, onDate: r.on_date, by: r.by, at: r.at }));
}

/** Active members not yet on the list (for the add form). */
export async function loadAddableMembers(tx: Tx, listId: string): Promise<{ id: string; name: string }[]> {
  return [
    ...(await tx<{ id: string; name: string }[]>`
      select m.id, m.last_name || ', ' || m.first_name as name
      from members m
      where m.tenant_id = app.tenant_id() and m.status <> 'separated'
        and not exists (select 1 from mandate_list_entries e where e.list_id = ${listId} and e.member_id = m.id and e.status = 'active')
      order by m.last_name, m.first_name
      limit 1000`),
  ];
}

/** Same check as manual fills: blocks are messages; empty means the member qualifies for the seat. */
export async function mandateQualification(tx: Tx, memberId: string, seatId: string, end: Date): Promise<string[]> {
  const [seat] = await loadSeats(tx, { seatId });
  const member = (await loadMemberQuals(tx, [memberId])).get(memberId);
  if (!seat || !member) return ['That seat or member was not found.'];
  const r = checkQualification(seat.rule, member, end, seat.tz);
  return r.qualified ? [] : r.explain.map((e) => `${member.name}: ${e.message}`);
}
