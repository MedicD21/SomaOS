'use server';
import { MODULE_KEYS, TERMINOLOGY_KEYS, tenantSettingsSchema } from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { runAdmin, zodFieldErrors } from '@/server/actions';

export async function saveSettings(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const terminology = Object.fromEntries(TERMINOLOGY_KEYS.map((k) => [k, String(form.get(`term.${k}`) ?? '')]));
  const modules = form.getAll('modules').map(String).filter((m) => (MODULE_KEYS as readonly string[]).includes(m));
  const parsed = tenantSettingsSchema.safeParse({
    timezone: form.get('timezone'),
    terminology,
    enabledModules: Array.from(new Set(['admin', ...modules])),
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const name = String(form.get('name') ?? '').trim();
  if (!name) return zodFieldErrors([{ path: ['name'], message: 'Required' }]);
  return runAdmin('admin.tenant.manage', form, async (tx) => {
    await tx`update tenants set name = ${name}, timezone = ${parsed.data.timezone} where id = app.tenant_id()`;
    await tx`update tenant_settings set terminology = ${tx.json(parsed.data.terminology)},
             enabled_modules = ${parsed.data.enabledModules} where tenant_id = app.tenant_id()`;
    return 'Settings saved';
  });
}
