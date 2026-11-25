import 'server-only';
import { checkQualification } from '@soma/schedule-engine';
import type { Tx } from '@/server/db';
import { loadMemberQuals, loadSeats } from './load';

export type TradeShift = {
  id: string;
  memberId: string;
  memberName: string;
  start: Date;
  end: Date;
  type: string;
  seat: string;
  unit: string;
  tz: string;
};

export type TradeView = {
  id: string;
  status: string;
  note: string | null;
  decisionNote: string | null;
  createdAt: Date;
  mine: TradeShift;          // the requester's shift
  theirs: TradeShift;        // the counterparty's shift
  iAmRequester: boolean;
  iAmCounterparty: boolean;
  canDecide: boolean;
};

type ShiftRow = {
  id: string; member_id: string; member_name: string; start: Date; end: Date; type: string; seat: string; unit: string; tz: string;
};

const shiftOf = (r: ShiftRow): TradeShift => ({
  id: r.id, memberId: r.member_id, memberName: r.member_name, start: r.start, end: r.end, type: r.type, seat: r.seat, unit: r.unit, tz: r.tz,
});

/** Upcoming scheduled, seated, non-Kelly shifts (the only ones that can be traded). */
export async function loadUpcomingShifts(tx: Tx, scope: 'mine' | 'others', days = 60): Promise<TradeShift[]> {
  const rows = await tx<ShiftRow[]>`
    select a.id, a.member_id, m.last_name || ', ' || m.first_name as member_name, lower(a.during) as start, upper(a.during) as "end",
           a.type, s.label as seat, ou.name as unit, coalesce(ou.timezone, t.timezone) as tz
    from shift_assignments a
    join members m on m.id = a.member_id
    join seats s on s.id = a.seat_id
    join org_units ou on ou.id = s.org_unit_id
    join tenants t on t.id = a.tenant_id
    where a.tenant_id = app.tenant_id() and a.status = 'scheduled' and a.type <> 'kelly'
      and lower(a.during) > now() and lower(a.during) < now() + make_interval(days => ${days})
      and m.status <> 'separated'
      and ${scope === 'mine' ? tx`a.member_id = app.my_member_id()` : tx`a.member_id is distinct from app.my_member_id()`}
      and not exists (select 1 from shift_trades x where x.status in ('awaiting_member', 'awaiting_approval')
                      and a.id in (x.requester_assignment_id, x.counterparty_assignment_id))
    order by lower(a.during), m.last_name
    limit 2000`;
  return rows.map(shiftOf);
}

/** Trades the caller may see (their own, plus those at stations they roster-edit). */
export async function loadTrades(tx: Tx): Promise<TradeView[]> {
  const rows = await tx<
    (ShiftRow & { m2_id: string; m2_member_id: string; m2_member_name: string; m2_start: Date; m2_end: Date; m2_type: string; m2_seat: string; m2_unit: string; m2_tz: string;
      trade_id: string; status: string; note: string | null; decision_note: string | null; created_at: Date; requester_id: string; counterparty_id: string; can_decide: boolean })[]
  >`
    select t.id as trade_id, t.status, t.note, t.decision_note, t.created_at, t.requester_id, t.counterparty_id, app.can_decide_trade(t.id) as can_decide,
           a1.id, a1.member_id, m1.last_name || ', ' || m1.first_name as member_name, lower(a1.during) as start, upper(a1.during) as "end", a1.type, s1.label as seat, o1.name as unit, coalesce(o1.timezone, tn.timezone) as tz,
           a2.id as m2_id, a2.member_id as m2_member_id, m2.last_name || ', ' || m2.first_name as m2_member_name, lower(a2.during) as m2_start, upper(a2.during) as m2_end, a2.type as m2_type, s2.label as m2_seat, o2.name as m2_unit, coalesce(o2.timezone, tn.timezone) as m2_tz
    from shift_trades t
    join tenants tn on tn.id = t.tenant_id
    join shift_assignments a1 on a1.id = t.requester_assignment_id
    join shift_assignments a2 on a2.id = t.counterparty_assignment_id
    join members m1 on m1.id = a1.member_id
    join members m2 on m2.id = a2.member_id
    join seats s1 on s1.id = a1.seat_id join org_units o1 on o1.id = s1.org_unit_id
    join seats s2 on s2.id = a2.seat_id join org_units o2 on o2.id = s2.org_unit_id
    order by t.created_at desc limit 100`;
  const me = (await tx<{ id: string | null }[]>`select app.my_member_id() as id`)[0]?.id ?? null;
  return rows.map((r) => ({
    id: r.trade_id,
    status: r.status,
    note: r.note,
    decisionNote: r.decision_note,
    createdAt: r.created_at,
    mine: shiftOf(r),
    theirs: shiftOf({ id: r.m2_id, member_id: r.m2_member_id, member_name: r.m2_member_name, start: r.m2_start, end: r.m2_end, type: r.m2_type, seat: r.m2_seat, unit: r.m2_unit, tz: r.m2_tz }),
    iAmRequester: r.requester_id === me,
    iAmCounterparty: r.counterparty_id === me,
    canDecide: r.can_decide,
  }));
}

/**
 * Qualification blocks if the trade went ahead: each member in the other's seat, checked with the same
 * engine as manual fills. Empty means the swap is allowed without an override.
 */
export async function tradeBlocks(tx: Tx, tradeId: string): Promise<string[]> {
  const [t] = await tx<{ a1: string; a2: string; m1: string; m2: string; s1: string; s2: string; e1: Date; e2: Date }[]>`
    select a1.id as a1, a2.id as a2, a1.member_id as m1, a2.member_id as m2, a1.seat_id as s1, a2.seat_id as s2, upper(a1.during) as e1, upper(a2.during) as e2
    from shift_trades t join shift_assignments a1 on a1.id = t.requester_assignment_id join shift_assignments a2 on a2.id = t.counterparty_assignment_id
    where t.id = ${tradeId}`;
  if (!t) return ['That trade was not found.'];
  const [seat1] = await loadSeats(tx, { seatId: t.s1 });
  const [seat2] = await loadSeats(tx, { seatId: t.s2 });
  const quals = await loadMemberQuals(tx, [t.m1, t.m2]);
  const out: string[] = [];
  // The requester's shift (seat1) goes to the counterparty (m2), and vice versa.
  for (const [seat, member, end] of [[seat1, t.m2, t.e1], [seat2, t.m1, t.e2]] as const) {
    const q = quals.get(member);
    if (!seat || !q) continue;
    const r = checkQualification(seat.rule, q, end, seat.tz);
    if (!r.qualified) for (const e of r.explain) out.push(`${q.name} in ${seat.label}: ${e.message}`);
  }
  return out;
}
