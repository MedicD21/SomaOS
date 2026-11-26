import 'server-only';
import type { Tx } from '@/server/db';

export type CsItem = { id: string; name: string; schedule: string; ndc: string | null; unit: string; archived: boolean };
export type CsLot = { id: string; itemId: string; itemName: string; unit: string; lotNo: string; expiresOn: string; recalled: boolean; recallNote: string | null; archived: boolean };
export type CsLocation = { id: string; name: string; kind: string; orgUnitId: string; unitName: string; seal: string | null; memberName: string | null; archived: boolean };

export async function loadCsItems(tx: Tx): Promise<CsItem[]> {
  const rows = await tx<{ id: string; name: string; schedule: string; ndc: string | null; unit: string; archived: boolean }[]>`
    select id, name, schedule, ndc, unit, archived_at is not null as archived from cs_items order by archived_at nulls first, name`;
  return [...rows];
}

export async function loadCsLots(tx: Tx): Promise<CsLot[]> {
  const rows = await tx<{ id: string; item_id: string; item_name: string; unit: string; lot_no: string; expires_on: string; recalled: boolean; recall_note: string | null; archived: boolean }[]>`
    select l.id, l.item_id, i.name as item_name, i.unit, l.lot_no, l.expires_on::text, l.recalled_at is not null as recalled, l.recall_note, l.archived_at is not null as archived
    from cs_lots l join cs_items i on i.id = l.item_id order by l.archived_at nulls first, i.name, l.expires_on`;
  return rows.map((r) => ({ id: r.id, itemId: r.item_id, itemName: r.item_name, unit: r.unit, lotNo: r.lot_no, expiresOn: r.expires_on, recalled: r.recalled, recallNote: r.recall_note, archived: r.archived }));
}

/** Custody locations in the caller's scope (the database filters by unit). */
export async function loadCsLocations(tx: Tx, includeArchived = false): Promise<CsLocation[]> {
  const rows = await tx<{ id: string; name: string; kind: string; org_unit_id: string; unit_name: string; seal: string | null; member_name: string | null; archived: boolean }[]>`
    select l.id, l.name, l.kind, l.org_unit_id, o.name as unit_name, l.current_seal_no as seal,
           m.last_name || ', ' || m.first_name as member_name, l.archived_at is not null as archived
    from cs_locations l join org_units o on o.id = l.org_unit_id left join members m on m.id = l.member_id
    where ${includeArchived} or l.archived_at is null order by o.name, l.name`;
  return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, orgUnitId: r.org_unit_id, unitName: r.unit_name, seal: r.seal, memberName: r.member_name, archived: r.archived }));
}

export async function loadUnits(tx: Tx): Promise<{ id: string; name: string }[]> {
  const rows = await tx<{ id: string; name: string }[]>`select id, name from org_units order by name`;
  return [...rows];
}

export async function loadMembersLite(tx: Tx): Promise<{ id: string; name: string }[]> {
  const rows = await tx<{ id: string; name: string }[]>`
    select id, last_name || ', ' || first_name as name from members where status <> 'separated' order by last_name, first_name`;
  return [...rows];
}
