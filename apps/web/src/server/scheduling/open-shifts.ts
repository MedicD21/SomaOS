import 'server-only';
import { checkQualification } from '@soma/schedule-engine';
import type { Tx } from '@/server/db';
import { loadMemberQuals, loadSeats } from './load';

export type ClaimView = { id: string; memberId: string; memberName: string; note: string | null; createdAt: Date; mine: boolean };

export type OpenShiftView = {
  id: string;
  seatLabel: string;
  unit: string;
  type: string;
  reason: string;
  start: Date;
  end: Date;
  tz: string;
  canManage: boolean;
  myClaimId: string | null;
  claims: ClaimView[];
};

/** Open shifts the caller may see (everyone with the claim permission, and officers of the unit). */
export async function loadOpenShifts(tx: Tx): Promise<OpenShiftView[]> {
  const shifts = await tx<
    { id: string; label: string; unit: string; type: string; reason: string; start: Date; end: Date; tz: string; can_manage: boolean; my_claim: string | null }[]
  >`
    select o.id, s.label, ou.name as unit, o.type, o.reason, lower(o.during) as start, upper(o.during) as "end",
           coalesce(ou.timezone, t.timezone) as tz,
           app.can_write_assignment('scheduling.roster.edit', o.seat_id) as can_manage,
           (select c.id from open_shift_claims c where c.open_shift_id = o.id and c.member_id = app.my_member_id() and c.status = 'pending') as my_claim
    from open_shifts o
    join seats s on s.id = o.seat_id
    join org_units ou on ou.id = s.org_unit_id
    join tenants t on t.id = o.tenant_id
    where o.status = 'open' and upper(o.during) > now()
    order by lower(o.during), s.label
    limit 100`;
  const claims = shifts.length
    ? await tx<{ id: string; open_shift_id: string; member_id: string; name: string; note: string | null; created_at: Date; mine: boolean }[]>`
        select c.id, c.open_shift_id, c.member_id, m.last_name || ', ' || m.first_name as name, c.note, c.created_at,
               (c.member_id = app.my_member_id()) as mine
        from open_shift_claims c join members m on m.id = c.member_id
        where c.status = 'pending' and c.open_shift_id = any(${shifts.map((s) => s.id)}::uuid[])
        order by c.created_at`
    : [];
  return shifts.map((s) => ({
    id: s.id,
    seatLabel: s.label,
    unit: s.unit,
    type: s.type,
    reason: s.reason,
    start: s.start,
    end: s.end,
    tz: s.tz,
    canManage: s.can_manage,
    myClaimId: s.my_claim,
    claims: claims
      .filter((c) => c.open_shift_id === s.id)
      .map((c) => ({ id: c.id, memberId: c.member_id, memberName: c.name, note: c.note, createdAt: c.created_at, mine: c.mine })),
  }));
}

/** Seats the caller may post open shifts for (roster edit at the seat's unit). */
export async function loadPostableSeats(tx: Tx): Promise<{ id: string; label: string }[]> {
  return [
    ...(await tx<{ id: string; label: string }[]>`
      select s.id, ou.name || ' — ' || s.label as label
      from seats s join org_units ou on ou.id = s.org_unit_id
      where s.status = 'active' and app.can_write_assignment('scheduling.roster.edit', s.id)
      order by ou.name, s.sort, s.label`),
  ];
}

/**
 * Qualification of the claimant for the seat, with the same engine as manual fills and trades.
 * `blocks` empty means the claim can be approved without an override; `acting` is true when the member
 * is below the seat's minimum rank but the seat allows acting.
 */
export async function claimQualification(tx: Tx, claimId: string): Promise<{ blocks: string[]; acting: boolean }> {
  const [c] = await tx<{ seat_id: string; member_id: string; end: Date }[]>`
    select o.seat_id, c.member_id, upper(o.during) as "end"
    from open_shift_claims c join open_shifts o on o.id = c.open_shift_id where c.id = ${claimId}`;
  if (!c) return { blocks: ['That claim was not found.'], acting: false };
  const [seat] = await loadSeats(tx, { seatId: c.seat_id });
  const member = (await loadMemberQuals(tx, [c.member_id])).get(c.member_id);
  if (!seat || !member) return { blocks: ['That seat or member was not found.'], acting: false };
  const r = checkQualification(seat.rule, member, c.end, seat.tz);
  return { blocks: r.qualified ? [] : r.explain.map((e) => `${member.name}: ${e.message}`), acting: r.acting };
}
