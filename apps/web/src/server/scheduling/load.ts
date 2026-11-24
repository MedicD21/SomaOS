import 'server-only';
import type { ConfigVersion } from '@soma/config-core';
import type { MemberQual, SeatRule, ShiftPattern } from '@soma/schedule-engine';
import type { Tx } from '@/server/db';

/** Approved `schedule.pattern` versions, oldest first. Pattern platoon keys are shift keys. */
export async function loadPatterns(tx: Tx): Promise<ConfigVersion<ShiftPattern>[]> {
  const rows = await tx<{ key: string; version: number; from: Date; to: Date | null; payload: ShiftPattern }[]>`
    select key, version, lower(effective) as "from", upper(effective) as "to", payload
    from config_versions
    where tenant_id = app.tenant_id() and kind = 'schedule.pattern' and status = 'approved'
    order by lower(effective), key`;
  return rows.map((r) => ({
    kind: 'schedule.pattern',
    key: r.key,
    version: r.version,
    effectiveFrom: r.from,
    effectiveTo: r.to,
    payload: r.payload,
  }));
}

export type SeatInfo = {
  id: string;
  label: string;
  sort: number;
  required: boolean;
  orgUnitId: string;
  orgUnitPath: string;
  tz: string;
  rule: SeatRule;
};

/** Active seats with their qualification rule and timezone (unit's, else the tenant's). */
export async function loadSeats(tx: Tx, filter: { seatId?: string; orgUnitIds?: string[] }): Promise<SeatInfo[]> {
  const rows = await tx<
    {
      id: string;
      label: string;
      sort: number;
      required: boolean;
      org_unit_id: string;
      path: string;
      tz: string;
      acting_allowed: boolean;
      min_rank_sort: number | null;
      groups: string[][] | null;
    }[]
  >`
    select s.id, s.label, s.sort, s.required, s.org_unit_id, ou.path::text as path,
           coalesce(ou.timezone, t.timezone) as tz, s.acting_allowed, r.sort as min_rank_sort,
           (select json_agg(g.ids order by g.group_no)
              from (select group_no, json_agg(credential_type_id order by credential_type_id) as ids
                    from seat_requirements where seat_id = s.id group by group_no) g) as groups
    from seats s
    join org_units ou on ou.id = s.org_unit_id
    join tenants t on t.id = s.tenant_id
    left join ranks r on r.id = s.min_rank_id
    where s.tenant_id = app.tenant_id() and s.status = 'active'
      ${filter.seatId ? tx`and s.id = ${filter.seatId}` : tx``}
      ${filter.orgUnitIds ? tx`and s.org_unit_id = any (${filter.orgUnitIds}::uuid[])` : tx``}
    order by s.sort, s.label`;
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    sort: r.sort,
    required: r.required,
    orgUnitId: r.org_unit_id,
    orgUnitPath: r.path,
    tz: r.tz,
    rule: {
      requirements: (r.groups ?? []).map((anyOf) => ({ anyOf })),
      minRankSort: r.min_rank_sort,
      actingAllowed: r.acting_allowed,
    },
  }));
}

/** Rank and active credentials per member, as the qualification check needs them. */
export async function loadMemberQuals(tx: Tx, memberIds: string[]): Promise<Map<string, MemberQual & { name: string }>> {
  const out = new Map<string, MemberQual & { name: string }>();
  if (memberIds.length === 0) return out;
  const members = await tx<{ id: string; name: string; rank_sort: number | null }[]>`
    select m.id, m.first_name || ' ' || m.last_name as name, r.sort as rank_sort
    from members m left join ranks r on r.id = m.rank_id
    where m.tenant_id = app.tenant_id() and m.id = any (${memberIds}::uuid[])`;
  for (const m of members) out.set(m.id, { name: m.name, rankSort: m.rank_sort, credentials: [] });
  const creds = await tx<{ member_id: string; type_id: string; type_label: string; expires_on: string | null }[]>`
    select member_id, type_id, type_label, expires_on::text as expires_on
    from app.member_qualifications(${memberIds}::uuid[])`;
  for (const c of creds) {
    out.get(c.member_id)?.credentials.push({ typeId: c.type_id, typeLabel: c.type_label, expiresOn: c.expires_on });
  }
  return out;
}
