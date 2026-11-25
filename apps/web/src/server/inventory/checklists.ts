import 'server-only';
import type { ChecklistItem } from '@soma/validators';
import type { Tx } from '@/server/db';

export type TemplateRow = {
  id: string;
  key: string;
  label: string;
  version: number;
  assetTypeId: string | null;
  assetTypeLabel: string | null;
  items: ChecklistItem[];
  logFailure: boolean;
  active: boolean;
};

export type CompletionRow = {
  id: string;
  templateLabel: string;
  version: number;
  assetName: string | null;
  unitName: string | null;
  completedBy: string;
  completedAt: Date;
  failedCount: number;
  note: string | null;
  items: ChecklistItem[];
  answers: Record<string, string | number>;
};

export async function loadTemplates(tx: Tx, activeOnly = true): Promise<TemplateRow[]> {
  const rows = await tx<{ id: string; key: string; label: string; version: number; asset_type_id: string | null; type_label: string | null; items: ChecklistItem[]; log_failure: boolean; active: boolean }[]>`
    select t.id, t.key, t.label, t.version, t.asset_type_id, at.label as type_label, t.items, t.log_failure, t.active
    from checklist_templates t left join asset_types at on at.id = t.asset_type_id
    where ${!activeOnly} or t.active order by t.label, t.version desc`;
  return rows.map((r) => ({ id: r.id, key: r.key, label: r.label, version: r.version, assetTypeId: r.asset_type_id, assetTypeLabel: r.type_label, items: r.items, logFailure: r.log_failure, active: r.active }));
}

export async function loadTemplate(tx: Tx, id: string): Promise<TemplateRow | null> {
  return (await loadTemplates(tx, false)).find((t) => t.id === id) ?? null;
}

export async function loadCompletions(tx: Tx, f: { assetId?: string; limit?: number } = {}): Promise<CompletionRow[]> {
  const rows = await tx<{ id: string; label: string; version: number; asset_name: string | null; unit_name: string | null; by: string; completed_at: Date; failed_count: number; note: string | null; snapshot: { items: ChecklistItem[] }; answers: Record<string, string | number> }[]>`
    select c.id, c.template_snapshot ->> 'label' as label, (c.template_snapshot ->> 'version')::int as version, a.name as asset_name, o.name as unit_name,
           m.last_name || ', ' || m.first_name as by, c.completed_at, c.failed_count, c.note, c.template_snapshot as snapshot, c.answers
    from checklist_completions c
    join members m on m.id = c.completed_by
    left join assets a on a.id = c.asset_id
    left join org_units o on o.id = c.org_unit_id
    where true ${f.assetId ? tx`and c.asset_id = ${f.assetId}` : tx``}
    order by c.completed_at desc limit ${f.limit ?? 25}`;
  return rows.map((r) => ({ id: r.id, templateLabel: r.label, version: r.version, assetName: r.asset_name, unitName: r.unit_name, completedBy: r.by, completedAt: r.completed_at, failedCount: r.failed_count, note: r.note, items: r.snapshot.items, answers: r.answers }));
}
