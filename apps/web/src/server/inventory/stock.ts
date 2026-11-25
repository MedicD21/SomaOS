import 'server-only';
import type { Tx } from '@/server/db';

export type ItemRow = { id: string; sku: string | null; name: string; category: string; unit: string; archived: boolean };
export type LocationRow = { id: string; name: string; kind: string; parentId: string | null; orgUnitId: string | null; archived: boolean; path: string };
export type LevelRow = { locationId: string; itemId: string; onHand: number; par: number | null; min: number | null };
export type LowRow = { locationId: string; itemId: string; onHand: number; par: number; shortBy: number; critical: boolean };

export async function loadItems(tx: Tx, includeArchived = false): Promise<ItemRow[]> {
  const rows = await tx<{ id: string; sku: string | null; name: string; category: string; unit: string; archived: boolean }[]>`
    select id, sku, name, category, unit, archived_at is not null as archived from items
    where ${includeArchived} or archived_at is null order by archived_at nulls first, name`;
  return [...rows];
}

/** Locations with a readable "Parent › Child" path. */
export async function loadLocations(tx: Tx, includeArchived = false): Promise<LocationRow[]> {
  const rows = await tx<{ id: string; name: string; kind: string; parent_id: string | null; org_unit_id: string | null; archived: boolean }[]>`
    select id, name, kind, parent_id, org_unit_id, archived_at is not null as archived from stock_locations
    where ${includeArchived} or archived_at is null order by name`;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pathOf = (r: { name: string; parent_id: string | null }): string => {
    const parts = [r.name];
    for (let p = r.parent_id ? byId.get(r.parent_id) : undefined, i = 0; p && i < 20; p = p.parent_id ? byId.get(p.parent_id) : undefined, i++) parts.unshift(p.name);
    return parts.join(' › ');
  };
  return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, parentId: r.parent_id, orgUnitId: r.org_unit_id, archived: r.archived, path: pathOf(r) })).sort((a, b) => a.path.localeCompare(b.path));
}

/** On-hand and par per (location, item) for one location. */
export async function loadLevels(tx: Tx, locationId: string): Promise<LevelRow[]> {
  const rows = await tx<{ location_id: string; item_id: string; on_hand: string | null; par: string | null; min: string | null }[]>`
    select ${locationId}::uuid as location_id, i.id as item_id, l.on_hand, p.par, p.min
    from items i
    left join stock_levels l on l.item_id = i.id and l.location_id = ${locationId}
    left join par_levels p on p.item_id = i.id and p.location_id = ${locationId}
    where i.archived_at is null or l.on_hand is not null
    order by i.name`;
  return rows.map((r) => ({ locationId: r.location_id, itemId: r.item_id, onHand: Number(r.on_hand ?? 0), par: r.par === null ? null : Number(r.par), min: r.min === null ? null : Number(r.min) }));
}

export async function loadLowStock(tx: Tx): Promise<LowRow[]> {
  const rows = await tx<{ location_id: string; item_id: string; on_hand: string; par: string; short_by: string; critical: boolean }[]>`
    select location_id, item_id, on_hand, par, short_by, critical from low_stock order by critical desc, short_by desc limit 500`;
  return rows.map((r) => ({ locationId: r.location_id, itemId: r.item_id, onHand: Number(r.on_hand), par: Number(r.par), shortBy: Number(r.short_by), critical: r.critical }));
}
