'use server';
import { localDateOf } from '@soma/schedule-engine';
import { staffingRulesSchema } from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { runAdmin, zodFieldErrors } from '@/server/actions';
import { getRequestContext } from '@/server/context';
import { approveStaffingDraft, saveStaffingDraft } from '@/server/scheduling/staffing';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Saves the form as the draft. The form edits one group, its department minimum and its per-unit
 * rule; a blank minimum leaves that rule out.
 */
export async function saveStaffingRules(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const key = String(form.get('groupKey') ?? '').trim() || 'als';
  if (!KEY.test(key)) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: { groupKey: 'Use lowercase letters, digits and _' } };
  const deptMin = String(form.get('departmentMin') ?? '').trim();
  const unitMin = String(form.get('unitMin') ?? '').trim();
  const unitType = String(form.get('unitTypeKey') ?? '').trim();
  const parsed = staffingRulesSchema.safeParse({
    groups: [{ key, label: form.get('groupLabel'), credentialKeys: form.getAll('credentialKeys').map(String) }],
    departmentMinimums: deptMin ? [{ group: key, min: deptMin }] : [],
    unitRules: unitMin && unitType ? [{ group: key, unitTypeKey: unitType, min: unitMin }] : [],
  });
  if (!parsed.success) {
    const fe = zodFieldErrors(parsed.error.issues).fieldErrors ?? {};
    return {
      ok: false,
      message: 'Please fix the highlighted fields.',
      fieldErrors: {
        groupLabel: fe['groups.0.label'] ?? '',
        credentialKeys: fe['groups.0.credentialKeys'] ?? '',
        departmentMin: fe['departmentMinimums.0.min'] ?? '',
        unitMin: fe['unitRules.0.min'] ?? '',
      },
    };
  }
  return runAdmin('scheduling.config.manage', form, async (tx) => `Saved draft v${await saveStaffingDraft(tx, parsed.data)}.`);
}

export async function approveStaffingRules(version: number, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const effectiveDate = String(form.get('effectiveFrom') ?? '');
  if (!DATE.test(effectiveDate) || Number.isNaN(Date.parse(`${effectiveDate}T00:00:00Z`))) {
    return { ok: false, message: 'Enter the date the rules take effect.', fieldErrors: { effectiveFrom: 'Required' } };
  }
  if (!Number.isInteger(version) || version < 1) return { ok: false, message: 'Unknown draft.' };
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('scheduling')) return { ok: false, message: 'Scheduling is not enabled for this department.' };
  const today = localDateOf(new Date(), ctx.tenant.timezone);
  return runAdmin('admin.config.manage', form, async (tx) => {
    await approveStaffingDraft(tx, version, effectiveDate, today);
    return `Approved v${version}, effective ${effectiveDate}.`;
  });
}
