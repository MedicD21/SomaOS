import 'server-only';
import type { Permission, Target } from '@soma/auth';
import { addDays, checkQualification, localDateOf, startOfLocalDay, type Explain, type IsoDate } from '@soma/schedule-engine';
import type { AssignInput } from '@soma/validators';
import type { Tx } from '@/server/db';
import { loadMemberQuals, loadSeats, type SeatInfo } from './load';

export type { AssignInput };

/** Plain permission check; server actions build it from `check(ctx, …).allowed`. */
export type Can = (permission: Permission, target: Target) => boolean;

export type AssignmentView = {
  id: string;
  memberId: string;
  memberName: string;
  type: string;
  start: Date;
  end: Date;
  acting: boolean;
  overrideReason: string | null;
};

export type RosterSeatView = {
  seat: { id: string; label: string; sort: number; required: boolean };
  assignment: AssignmentView | null;
  issues: Explain[];
};

export type RosterUnitView = {
  orgUnitId: string;
  name: string;
  path: string;
  seats: RosterSeatView[];
  requiredFilled: number;
  requiredTotal: number;
};

export type RosterDay = { units: RosterUnitView[] };

export type AssignResult = { ok: true; id: string } | { ok: false; blocked: Explain[] };

/**
 * The roster for one local date: every unit with active seats (under orgUnitId when given),
 * each seat with the scheduled assignment that starts on that date in the unit's timezone.
 * Qualification is re-checked on every view so lapsed credentials surface on future rosters.
 */
export async function loadRoster(tx: Tx, date: IsoDate, orgUnitId: string | null): Promise<RosterDay> {
  const units = await tx<{ id: string; name: string; path: string }[]>`
    select ou.id, ou.name, ou.path::text as path
    from org_units ou
    where ou.tenant_id = app.tenant_id()
      and exists (select 1 from seats s where s.org_unit_id = ou.id and s.status = 'active')
      ${
        orgUnitId
          ? tx`and ou.path operator(extensions.<@) (select p.path from org_units p where p.id = ${orgUnitId})`
          : tx``
      }
    order by ou.path`;
  if (units.length === 0) return { units: [] };

  const seats = await loadSeats(tx, { orgUnitIds: units.map((u) => u.id) });
  const windows = seats.map((s) => ({
    seat_id: s.id,
    lo: startOfLocalDay(date, s.tz).toISOString(),
    hi: startOfLocalDay(addDays(date, 1), s.tz).toISOString(),
  }));
  const rows = await tx<
    { id: string; seat_id: string; member_id: string; type: string; start: Date; end: Date; acting: boolean; override_reason: string | null }[]
  >`
    select a.id, a.seat_id, a.member_id, a.type, lower(a.during) as start, upper(a.during) as "end",
           a.acting, a.override_reason
    from jsonb_to_recordset(${tx.json(windows)}::jsonb) as w(seat_id uuid, lo timestamptz, hi timestamptz)
    join shift_assignments a on a.seat_id = w.seat_id
    where a.tenant_id = app.tenant_id() and a.status = 'scheduled'
      and lower(a.during) >= w.lo and lower(a.during) < w.hi
    order by lower(a.during), a.created_at`;
  const bySeat = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!bySeat.has(r.seat_id)) bySeat.set(r.seat_id, r);
  const quals = await loadMemberQuals(tx, [...new Set(rows.map((r) => r.member_id))]);

  const seatView = (s: SeatInfo): RosterSeatView => {
    const a = bySeat.get(s.id);
    const seat = { id: s.id, label: s.label, sort: s.sort, required: s.required };
    if (!a) return { seat, assignment: null, issues: [] };
    const q = quals.get(a.member_id);
    // When qualified, explain holds only `rank.acting` notes; otherwise it lists every failure.
    const issues = q ? checkQualification(s.rule, q, a.end, s.tz).explain : [];
    return {
      seat,
      assignment: {
        id: a.id,
        memberId: a.member_id,
        memberName: q?.name ?? 'Unknown member',
        type: a.type,
        start: a.start,
        end: a.end,
        acting: a.acting,
        overrideReason: a.override_reason,
      },
      issues,
    };
  };

  return {
    units: units.map((u) => {
      const unitSeats = seats.filter((s) => s.orgUnitId === u.id).map(seatView);
      const required = unitSeats.filter((s) => s.seat.required);
      return {
        orgUnitId: u.id,
        name: u.name,
        path: u.path,
        seats: unitSeats,
        requiredFilled: required.filter((s) => s.assignment).length,
        requiredTotal: required.length,
      };
    }),
  };
}

/**
 * Manually fills a seat. Unqualified members are blocked unless an override reason is given
 * by someone holding scheduling.qualification.override at the seat's unit.
 */
export async function assignToSeat(tx: Tx, can: Can, input: AssignInput): Promise<AssignResult> {
  const start = new Date(input.start);
  const end = new Date(input.end);
  if (!(start.getTime() < end.getTime())) {
    return { ok: false, blocked: [{ rule: 'input.invalid_range', message: 'The end must be after the start.' }] };
  }
  // Kelly days are generated from standing seats only and never occupy a seat.
  if (input.type === 'kelly') {
    return { ok: false, blocked: [{ rule: 'input.invalid_type', message: 'Kelly days cannot be assigned to a seat.' }] };
  }
  const [seat] = await loadSeats(tx, { seatId: input.seatId });
  if (!seat) return { ok: false, blocked: [{ rule: 'seat.missing', message: 'That seat no longer exists.' }] };
  const target: Target = { orgUnitPath: seat.orgUnitPath };
  if (!can('scheduling.roster.edit', target)) {
    return { ok: false, blocked: [{ rule: 'permission', message: "You cannot change this unit's roster." }] };
  }
  const member = (await loadMemberQuals(tx, [input.memberId])).get(input.memberId);
  if (!member) return { ok: false, blocked: [{ rule: 'member.missing', message: 'That member was not found.' }] };
  const [sep] = await tx<{ separated: boolean }[]>`
    select (status = 'separated' or separated_on <= ${localDateOf(start, seat.tz)}::date) as separated
    from members where id = ${input.memberId} and tenant_id = app.tenant_id()`;
  if (sep?.separated) {
    return { ok: false, blocked: [{ rule: 'member.separated', message: 'That member has separated from the department.' }] };
  }

  const result = checkQualification(seat.rule, member, end, seat.tz);
  let overrideReason: string | null = null;
  if (!result.qualified) {
    if (!input.overrideReason) return { ok: false, blocked: result.explain };
    if (!can('scheduling.qualification.override', target)) {
      return {
        ok: false,
        blocked: [
          { rule: 'permission', message: 'You cannot override qualification blocks for this unit.' },
          ...result.explain,
        ],
      };
    }
    overrideReason = input.overrideReason;
    // Only an applied override is recorded as the audit reason for this insert.
    await tx`select set_config('app.reason', ${overrideReason}, true)`;
  }

  const [row] = await tx<{ id: string }[]>`
    insert into shift_assignments
      (tenant_id, member_id, seat_id, during, type, source, acting, override_reason, explain)
    values (app.tenant_id(), ${input.memberId}, ${input.seatId}, tstzrange(${start.toISOString()}, ${end.toISOString()}),
            ${input.type}, 'manual', ${result.acting}, ${overrideReason}, ${tx.json(result.explain)})
    returning id`;
  return { ok: true, id: row!.id };
}

/** Cancels a scheduled assignment (no hard deletes). Generation never resurrects it. */
export async function cancelAssignment(tx: Tx, id: string, reason: string): Promise<void> {
  const trimmed = reason.trim();
  if (trimmed.length < 5 || trimmed.length > 500) {
    throw new RangeError('A cancel reason of at least 5 characters is required');
  }
  const rows = await tx`
    update shift_assignments set status = 'cancelled', cancelled_reason = ${trimmed}
    where id = ${id} and tenant_id = app.tenant_id() and status = 'scheduled'
    returning id`;
  if (rows.length === 0) throw new Error('That assignment was not found or is already cancelled.');
}
