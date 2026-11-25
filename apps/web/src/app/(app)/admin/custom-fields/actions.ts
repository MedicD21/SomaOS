'use server';
import { customFieldDefSchema } from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { runAdmin, zodFieldErrors } from '@/server/actions';

export async function addCustomField(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = customFieldDefSchema.safeParse({
    label: form.get('label'), key: form.get('key') || undefined, type: form.get('type'), options: form.get('options') || '',
    required: form.get('required') === 'on', sensitivity: form.get('sensitivity'),
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const d = parsed.data;
  const entity = form.get('entity') === 'asset' ? 'asset' : 'member';
  return runAdmin('admin.custom_fields.manage', form, async (tx) => {
    await tx`insert into custom_field_defs (tenant_id, entity, key, label, type, options, required, sensitivity)
             values (app.tenant_id(), ${entity},${d.key}, ${d.label}, ${d.type}, ${d.options ? tx.json(d.options) : null}, ${d.required}, ${d.sensitivity})`;
    return `Added ${d.label}`;
  });
}

export async function archiveCustomField(id: string, archive: boolean, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  return runAdmin('admin.custom_fields.manage', form, async (tx) => {
    await tx`update custom_field_defs set archived_at = ${archive ? new Date() : null} where id = ${id}`;
    return archive ? 'Archived' : 'Restored';
  });
}
