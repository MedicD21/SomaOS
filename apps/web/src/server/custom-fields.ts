import 'server-only';
import type { CustomFieldDef } from '@soma/custom-fields';
import { buildCustomFieldSchema } from '@soma/custom-fields';
import type { Tx } from './db';

export type FieldDefRow = CustomFieldDef & { id: string; sensitivity: string | null };

export async function loadFieldDefs(tx: Tx, entity: 'member' | 'org_unit', includeArchived = false): Promise<FieldDefRow[]> {
  const rows = await tx<{ id: string; key: string; label: string; type: CustomFieldDef['type']; options: CustomFieldDef['options'] | null; required: boolean; sensitivity: string | null; archived: boolean }[]>`
    select id, key, label, type, options, required, sensitivity, archived_at is not null as archived
    from custom_field_defs where entity = ${entity} and (${includeArchived} or archived_at is null)
    order by sort, label`;
  return rows.map((r) => ({ ...r, options: r.options ?? undefined }));
}

/** Reads `custom.<key>` inputs into typed values (blank → omitted). */
export function customFromForm(defs: FieldDefRow[], form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    const name = `custom.${d.key}`;
    if (d.type === 'multi_select') {
      const v = form.getAll(name).map(String);
      if (v.length) out[d.key] = v;
    } else if (d.type === 'boolean') {
      out[d.key] = form.get(name) === 'on';
    } else {
      const raw = String(form.get(name) ?? '').trim();
      if (raw === '') continue;
      out[d.key] = d.type === 'number' || d.type === 'integer' ? Number(raw) : raw;
    }
  }
  return out;
}

/** Validates custom values, keeping existing values of archived/hidden fields. */
export function validateCustom(defs: FieldDefRow[], values: Record<string, unknown>, existing: Record<string, unknown> = {}) {
  const visibleKeys = new Set(defs.map((d) => d.key));
  const preserved = Object.fromEntries(Object.entries(existing).filter(([k]) => !visibleKeys.has(k)));
  const schema = buildCustomFieldSchema(defs).loose();
  const r = schema.safeParse({ ...preserved, ...values });
  if (r.success) return { ok: true as const, value: r.data as Record<string, unknown> };
  const fieldErrors: Record<string, string> = {};
  for (const i of r.error.issues) fieldErrors[`custom.${i.path.join('.')}`] ??= i.message.includes('received undefined') ? 'Required' : i.message;
  return { ok: false as const, fieldErrors };
}
