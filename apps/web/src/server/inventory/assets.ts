import 'server-only';
import type { Tx } from '@/server/db';

export type Opt = { id: string; label: string };

export type AssetTypeRow = { id: string; key: string; label: string; category: string; archived: boolean };
export type AssetRow = {
  id: string;
  name: string;
  identifier: string | null;
  status: string;
  typeId: string;
  typeLabel: string;
  unitId: string | null;
  unitName: string | null;
  archived: boolean;
  custom: Record<string, unknown>;
};
export type AssetEventRow = {
  id: string;
  kind: string;
  occurredAt: Date;
  by: string | null;
  note: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  fromUnit: string | null;
  toUnit: string | null;
  data: Record<string, unknown>;
};

export const STATUS_LABEL: Record<string, string> = {
  in_service: 'In service',
  out_of_service: 'Out of service',
  reserve: 'Reserve',
  maintenance: 'Maintenance',
  retired: 'Retired',
};

export async function loadAssetTypes(tx: Tx, includeArchived = false): Promise<AssetTypeRow[]> {
  const rows = await tx<{ id: string; key: string; label: string; category: string; archived: boolean }[]>`
    select id, key, label, category, archived_at is not null as archived from asset_types
    where ${includeArchived} or archived_at is null order by archived_at nulls first, label`;
  return [...rows];
}

export async function loadUnits(tx: Tx): Promise<Opt[]> {
  const rows = await tx<{ id: string; label: string }[]>`select id, name as label from org_units where status = 'active' order by path`;
  return [...rows];
}

export async function loadAssets(tx: Tx, f: { status?: string; unitId?: string; typeId?: string; includeArchived?: boolean } = {}): Promise<AssetRow[]> {
  const rows = await tx<{ id: string; name: string; identifier: string | null; status: string; type_id: string; type_label: string; unit_id: string | null; unit_name: string | null; archived: boolean; custom: Record<string, unknown> }[]>`
    select a.id, a.name, a.identifier, a.status, a.type_id, t.label as type_label, a.org_unit_id as unit_id, o.name as unit_name,
           a.archived_at is not null as archived, a.custom
    from assets a join asset_types t on t.id = a.type_id left join org_units o on o.id = a.org_unit_id
    where (${f.includeArchived ?? false} or a.archived_at is null)
      ${f.status ? tx`and a.status = ${f.status}` : tx``}
      ${f.unitId ? tx`and a.org_unit_id = ${f.unitId}` : tx``}
      ${f.typeId ? tx`and a.type_id = ${f.typeId}` : tx``}
    order by t.label, a.name limit 500`;
  return rows.map((r) => ({ id: r.id, name: r.name, identifier: r.identifier, status: r.status, typeId: r.type_id, typeLabel: r.type_label, unitId: r.unit_id, unitName: r.unit_name, archived: r.archived, custom: r.custom }));
}

export async function loadAsset(tx: Tx, id: string): Promise<{ asset: AssetRow; events: AssetEventRow[] } | null> {
  const [asset] = (await loadAssets(tx, { includeArchived: true })).filter((a) => a.id === id);
  if (!asset) return null;
  const events = await tx<{ id: string; kind: string; occurred_at: Date; by: string | null; note: string | null; from_status: string | null; to_status: string | null; from_unit: string | null; to_unit: string | null; data: Record<string, unknown> }[]>`
    select e.id, e.kind, e.occurred_at, (select m.last_name || ', ' || m.first_name from members m where m.user_id = e.performed_by and m.tenant_id = e.tenant_id limit 1) as by,
           e.note, e.from_status, e.to_status, fo.name as from_unit, too.name as to_unit, e.data
    from asset_events e left join org_units fo on fo.id = e.from_org_unit_id left join org_units too on too.id = e.to_org_unit_id
    where e.asset_id = ${id} order by e.occurred_at desc, e.id desc limit 200`;
  return {
    asset,
    events: events.map((e) => ({ id: e.id, kind: e.kind, occurredAt: e.occurred_at, by: e.by, note: e.note, fromStatus: e.from_status, toStatus: e.to_status, fromUnit: e.from_unit, toUnit: e.to_unit, data: e.data })),
  };
}
