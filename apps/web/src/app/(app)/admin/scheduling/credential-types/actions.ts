'use server';
import { credentialTypeSchema } from '@soma/validators';
import { z } from 'zod';
import type { ActionResult } from '@/server/actions';
import { ActionError, runAdmin, zodFieldErrors } from '@/server/actions';

const uuid = z.uuid();

function readType(form: FormData) {
  const warn = String(form.get('warnDays') ?? '').trim();
  return credentialTypeSchema.safeParse({
    key: form.get('key'),
    label: form.get('label'),
    validity: {
      kind: form.get('kind'),
      months: form.get('months'),
      month: form.get('month'),
      day: form.get('day'),
      years: form.get('years'),
    },
    warnDays: warn ? warn.split(/[\s,]+/).filter(Boolean) : undefined,
  });
}

export async function saveCredentialType(id: string | null, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  if (id !== null && !uuid.safeParse(id).success) return { ok: false, message: 'Unknown credential type.' };
  const parsed = readType(form);
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  const warnDays = [...new Set(v.warnDays)].sort((a, b) => b - a);
  return runAdmin('scheduling.config.manage', form, async (tx) => {
    if (id) {
      // Existing member credentials keep their stored expiry; only new entries use the new validity.
      const rows = await tx`update credential_types set key = ${v.key}, label = ${v.label}, validity = ${tx.json(v.validity as never)}, warn_days = ${warnDays}
                            where id = ${id} and tenant_id = app.tenant_id() returning id`;
      if (rows.length === 0) throw new ActionError('That credential type was not found.');
      return 'Saved';
    }
    await tx`insert into credential_types (tenant_id, key, label, validity, warn_days)
             values (app.tenant_id(), ${v.key}, ${v.label}, ${tx.json(v.validity as never)}, ${warnDays})`;
    return `Added ${v.label}`;
  });
}

export async function setCredentialTypeStatus(id: string, status: 'active' | 'archived', _prev: ActionResult, form: FormData): Promise<ActionResult> {
  if (!uuid.safeParse(id).success || !['active', 'archived'].includes(status)) return { ok: false, message: 'Unknown credential type.' };
  return runAdmin('scheduling.config.manage', form, async (tx) => {
    const rows = await tx`update credential_types set status = ${status} where id = ${id} and tenant_id = app.tenant_id() returning label`;
    if (rows.length === 0) throw new ActionError('That credential type was not found.');
    return status === 'archived' ? `Archived ${rows[0]!.label}` : `Restored ${rows[0]!.label}`;
  });
}
