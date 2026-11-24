'use server';
import { orgUnitSchema } from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { runAdmin, zodFieldErrors } from '@/server/actions';

export async function createOrgUnit(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = orgUnitSchema.safeParse({
    name: form.get('name'), typeId: form.get('typeId'), parentId: form.get('parentId'), code: form.get('code') ?? undefined,
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('admin.org.manage', form, async (tx) => {
    await tx`insert into org_units (tenant_id, type_id, parent_id, name, code)
             values (app.tenant_id(), ${v.typeId}, ${v.parentId}, ${v.name}, ${v.code})`;
    return `Added ${v.name}`;
  });
}

export async function updateOrgUnit(id: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = orgUnitSchema.safeParse({
    name: form.get('name'), typeId: form.get('typeId'), parentId: form.get('parentId'), code: form.get('code') ?? undefined,
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('admin.org.manage', form, async (tx) => {
    const rows = await tx`update org_units set name = ${v.name}, type_id = ${v.typeId}, parent_id = ${v.parentId}, code = ${v.code}
                          where id = ${id} returning id`;
    if (rows.length === 0) throw new Error('row-level security: not found');
    return 'Saved';
  });
}

export async function setOrgUnitStatus(id: string, status: 'active' | 'archived', _prev: ActionResult, form: FormData): Promise<ActionResult> {
  return runAdmin('admin.org.manage', form, async (tx) => {
    await tx`update org_units set status = ${status} where id = ${id}`;
    return status === 'archived' ? 'Archived' : 'Restored';
  });
}
