'use server';
import { rankSchema, shiftSchema } from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { runAdmin, zodFieldErrors } from '@/server/actions';

export async function saveRank(id: string | null, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = rankSchema.safeParse({ key: form.get('key'), label: form.get('label'), sort: form.get('sort') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('admin.org.manage', form, async (tx) => {
    if (id) await tx`update ranks set key = ${v.key}, label = ${v.label}, sort = ${v.sort} where id = ${id}`;
    else await tx`insert into ranks (tenant_id, key, label, sort) values (app.tenant_id(), ${v.key}, ${v.label}, ${v.sort})`;
    return id ? 'Saved' : `Added ${v.label}`;
  });
}

export async function saveShift(id: string | null, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = shiftSchema.safeParse({ key: form.get('key'), label: form.get('label'), color: form.get('color') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('admin.org.manage', form, async (tx) => {
    if (id) await tx`update shifts set key = ${v.key}, label = ${v.label}, color = ${v.color} where id = ${id}`;
    else await tx`insert into shifts (tenant_id, key, label, color, sort)
                  values (app.tenant_id(), ${v.key}, ${v.label}, ${v.color}, (select coalesce(max(sort), 0) + 1 from shifts))`;
    return id ? 'Saved' : `Added ${v.label}`;
  });
}
