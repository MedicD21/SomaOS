import 'server-only';
import type { Tx } from '@/server/db';

export type SheetLine = { lotId: string; itemName: string; unit: string; lotNo: string; expiresOn: string };
export type CountRow = { id: string; locationName: string; countedBy: string; witness: string; at: string; sealOk: boolean; lines: number; discrepancies: number };
export type DiscrepancyEvent = { kind: string; by: string; note: string | null; reportRef: string | null; at: string };
export type Discrepancy = {
  id: string; locationId: string; locationName: string; kind: string; itemName: string | null; lotNo: string | null; expected: number | null; counted: number | null;
  status: string; openedAt: string; countedBy: string | null; events: DiscrepancyEvent[];
};
export type ExpiryRow = { locationId: string; locationName: string; itemName: string; lotNo: string; expiresOn: string; daysLeft: number; onHand: number };
export type RecalledRow = { locationId: string; locationName: string; itemName: string; lotNo: string; note: string | null; onHand: number };

/** The blind sheet: lots held at the location, names only. Expected quantities are never sent to the page. */
export async function loadCountSheet(tx: Tx, locationId: string): Promise<SheetLine[]> {
  const rows = await tx<{ lot_id: string; item_name: string; unit: string; lot_no: string; expires_on: string }[]>`
    select lot_id, item_name, unit, lot_no, expires_on::text from app.cs_count_sheet(${locationId})`;
  return rows.map((r) => ({ lotId: r.lot_id, itemName: r.item_name, unit: r.unit, lotNo: r.lot_no, expiresOn: r.expires_on }));
}

export async function loadRecentCounts(tx: Tx, limit = 20): Promise<CountRow[]> {
  const rows = await tx<{ id: string; location_name: string; counted_by: string; witness: string; at: string; seal_ok: boolean; lines: string; discrepancies: string }[]>`
    with recent as (select * from cs_counts order by counted_at desc limit ${limit})
    select c.id, l.name as location_name, mc.last_name || ', ' || mc.first_name as counted_by, mw.last_name || ', ' || mw.first_name as witness,
           c.counted_at::text as at, c.seal_ok,
           (select count(*) from cs_count_lines x where x.count_id = c.id)::text as lines,
           (select count(*) from cs_discrepancies d where d.count_id = c.id)::text as discrepancies
    from recent c join cs_locations l on l.id = c.location_id
    join members mc on mc.id = c.counted_by join members mw on mw.id = c.witnessed_by
    order by c.counted_at desc`;
  return rows.map((r) => ({ id: r.id, locationName: r.location_name, countedBy: r.counted_by, witness: r.witness, at: r.at, sealOk: r.seal_ok, lines: Number(r.lines), discrepancies: Number(r.discrepancies) }));
}

export async function loadDiscrepancies(tx: Tx, includeResolved: boolean): Promise<Discrepancy[]> {
  const rows = await tx<{
    id: string; location_id: string; location_name: string; kind: string; item_name: string | null; lot_no: string | null;
    expected: string | null; counted: string | null; status: string; opened_at: string; counted_by: string | null;
  }[]>`
    select d.id, d.location_id, l.name as location_name, d.kind, i.name as item_name, lt.lot_no, d.expected, d.counted, d.status, d.opened_at::text,
           case when c.id is null then null else m.last_name || ', ' || m.first_name end as counted_by
    from cs_discrepancies d join cs_locations l on l.id = d.location_id
    left join cs_lots lt on lt.id = d.lot_id left join cs_items i on i.id = lt.item_id
    left join cs_counts c on c.id = d.count_id left join members m on m.id = c.counted_by
    where ${includeResolved} or d.status <> 'resolved'
    order by (d.status = 'resolved'), d.opened_at desc limit 100`;
  const ids = rows.map((r) => r.id);
  const events = ids.length
    ? await tx<{ discrepancy_id: string; kind: string; by: string; note: string | null; report_ref: string | null; at: string }[]>`
        select e.discrepancy_id, e.kind, m.last_name || ', ' || m.first_name as by, e.note, e.report_ref, e.occurred_at::text as at
        from cs_discrepancy_events e join members m on m.id = e.by_member
        where e.discrepancy_id = any(${ids}::uuid[]) order by e.occurred_at`
    : [];
  return rows.map((r) => ({
    id: r.id, locationId: r.location_id, locationName: r.location_name, kind: r.kind, itemName: r.item_name, lotNo: r.lot_no,
    expected: r.expected === null ? null : Number(r.expected), counted: r.counted === null ? null : Number(r.counted),
    status: r.status, openedAt: r.opened_at, countedBy: r.counted_by,
    events: events.filter((e) => e.discrepancy_id === r.id).map((e) => ({ kind: e.kind, by: e.by, note: e.note, reportRef: e.report_ref, at: e.at })),
  }));
}

export async function loadExpiring(tx: Tx, days: number): Promise<ExpiryRow[]> {
  const rows = await tx<{ location_id: string; location_name: string; item_name: string; lot_no: string; expires_on: string; days_left: number; on_hand: string }[]>`
    select e.location_id, l.name as location_name, i.name as item_name, e.lot_no, e.expires_on::text, e.days_left, e.on_hand
    from cs_expiring e join cs_locations l on l.id = e.location_id join cs_items i on i.id = e.item_id
    where e.days_left <= ${days} order by e.days_left, i.name limit 200`;
  return rows.map((r) => ({ locationId: r.location_id, locationName: r.location_name, itemName: r.item_name, lotNo: r.lot_no, expiresOn: r.expires_on, daysLeft: Number(r.days_left), onHand: Number(r.on_hand) }));
}

export async function loadRecalled(tx: Tx): Promise<RecalledRow[]> {
  const rows = await tx<{ location_id: string; location_name: string; item_name: string; lot_no: string; recall_note: string | null; on_hand: string }[]>`
    select r.location_id, l.name as location_name, i.name as item_name, r.lot_no, r.recall_note, r.on_hand
    from cs_recalled r join cs_locations l on l.id = r.location_id join cs_items i on i.id = r.item_id order by i.name limit 200`;
  return rows.map((r) => ({ locationId: r.location_id, locationName: r.location_name, itemName: r.item_name, lotNo: r.lot_no, note: r.recall_note, onHand: Number(r.on_hand) }));
}
