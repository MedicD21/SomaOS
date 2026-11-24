'use server';
import { keyFromLabel, roleSchema } from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { runAdmin, zodFieldErrors } from '@/server/actions';

export async function saveRole(id: string | null, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const label = String(form.get('label') ?? '');
  const parsed = roleSchema.safeParse({
    label, key: String(form.get('key') || keyFromLabel(label)), permissions: form.getAll('permissions').map(String),
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const r = parsed.data;
  return runAdmin('admin.roles.manage', form, async (tx) => {
    let roleId = id;
    if (roleId) {
      await tx`update roles set label = ${r.label} where id = ${roleId}`;
      // Insert additions before deletions so the last-admin guard sees the final state.
    } else {
      const [row] = await tx<{ id: string }[]>`insert into roles (tenant_id, key, label) values (app.tenant_id(), ${r.key}, ${r.label}) returning id`;
      roleId = row!.id;
    }
    for (const p of r.permissions) {
      await tx`insert into role_permissions (tenant_id, role_id, permission) values (app.tenant_id(), ${roleId}, ${p}) on conflict do nothing`;
    }
    await tx`delete from role_permissions where role_id = ${roleId} and not (permission = any(${r.permissions}))`;
    return id ? 'Saved' : `Added ${r.label}`;
  });
}
