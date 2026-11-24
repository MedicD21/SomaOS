import 'server-only';
import { daysBetween, planRegularRoster, type IsoDate, type StandingSeat } from '@soma/schedule-engine';
import type { Tx } from '@/server/db';
import { loadPatterns } from './load';
import type { Can } from './roster';

export const MAX_GENERATE_DAYS = 120;

export class RosterPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RosterPermissionError';
  }
}

/**
 * Generates regular and Kelly assignments from standing seats for [from, toExclusive), as the
 * signed-in user (RLS applies). Idempotent: rows that already exist (including cancelled
 * generated rows) or that would collide with any scheduled assignment are skipped.
 */
export async function generateRoster(
  tx: Tx,
  can: Can,
  from: IsoDate,
  toExclusive: IsoDate,
): Promise<{ inserted: number; skipped: number }> {
  const days = daysBetween(from, toExclusive);
  if (days <= 0) throw new RangeError('The end date must be after the start date');
  if (days > MAX_GENERATE_DAYS) throw new RangeError(`Generate at most ${MAX_GENERATE_DAYS} days at a time`);
  // Kelly rows carry no seat, so writing them needs department-wide scope.
  if (!can('scheduling.roster.edit', {})) {
    throw new RosterPermissionError('Generating the roster requires department-wide roster edit permission.');
  }

  const patterns = await loadPatterns(tx);
  const standingRows = await tx<
    { member_id: string; seat_id: string; platoon: string; kelly_group: number | null; ef: string; et: string | null; tz: string }[]
  >`
    select ss.member_id, ss.seat_id, sh.key as platoon, ss.kelly_group,
           lower(ss.effective)::text as ef, upper(ss.effective)::text as et,
           coalesce(ou.timezone, t.timezone) as tz
    from standing_seats ss
    join shifts sh on sh.id = ss.platoon_shift_id
    join seats s on s.id = ss.seat_id and s.status = 'active'
    join org_units ou on ou.id = s.org_unit_id
    join tenants t on t.id = ss.tenant_id
    where ss.tenant_id = app.tenant_id()
      and ss.effective && daterange(${from}::date, ${toExclusive}::date)`;
  if (patterns.length === 0 || standingRows.length === 0) return { inserted: 0, skipped: 0 };

  const standing: StandingSeat[] = standingRows.map((r) => ({
    memberId: r.member_id,
    seatId: r.seat_id,
    platoon: r.platoon,
    kellyGroup: r.kelly_group,
    effectiveFrom: r.ef,
    effectiveTo: r.et,
    tz: r.tz,
  }));
  const memberIds = [...new Set(standing.map((s) => s.memberId))];
  const members = await tx<{ id: string; separated_on: string | null }[]>`
    select id, case when status = 'separated' then coalesce(separated_on, ${from}::date)::text end as separated_on
    from members where tenant_id = app.tenant_id() and id = any (${memberIds}::uuid[])`;

  const planned = planRegularRoster({
    patterns,
    standing,
    members: members.map((m) => ({ memberId: m.id, separatedOn: m.separated_on })),
    from,
    toExclusive,
  });
  if (planned.length === 0) return { inserted: 0, skipped: 0 };

  const rows = planned.map((p) => ({
    member_id: p.memberId,
    seat_id: p.seatId,
    starts: p.start.toISOString(),
    ends: p.end.toISOString(),
    type: p.type,
    pattern_version: p.patternVersion,
    explain: p.explain,
  }));
  // No conflict target: skips the generated-key duplicates and the member/seat overlap exclusions alike.
  const inserted = await tx`
    insert into shift_assignments (tenant_id, member_id, seat_id, during, type, source, pattern_version, explain)
    select app.tenant_id(), r.member_id, r.seat_id, tstzrange(r.starts, r.ends), r.type, 'generated',
           r.pattern_version, r.explain
    from jsonb_to_recordset(${tx.json(rows)}::jsonb)
      as r(member_id uuid, seat_id uuid, starts timestamptz, ends timestamptz, type text, pattern_version int, explain jsonb)
    on conflict do nothing
    returning id`;
  return { inserted: inserted.length, skipped: planned.length - inserted.length };
}
