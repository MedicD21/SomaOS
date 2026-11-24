'use server';
import { redirect } from 'next/navigation';
import { localDateOf } from '@soma/schedule-engine';
import { shiftPatternSchema } from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { runAdmin, zodFieldErrors } from '@/server/actions';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { approvePatternDraft, savePatternDraft } from '@/server/scheduling/patterns';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MODULE_OFF: ActionResult = { ok: false, message: 'Scheduling is not enabled for this department.' };

export async function savePattern(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('scheduling')) return MODULE_OFF;
  // Platoon offsets are keyed by the department's shift keys; unknown keys cannot be injected.
  const shiftKeys = (await withCtxDb(ctx, (tx) => tx<{ key: string }[]>`select key from shifts order by sort`)).map((s) => s.key);
  const kellyEvery = String(form.get('kellyEvery') ?? '').trim();
  const parsed = shiftPatternSchema.safeParse({
    cycle: String(form.get('cycle') ?? '').split(',').filter(Boolean),
    shiftStart: form.get('shiftStart'),
    shiftHours: form.get('shiftHours'),
    anchorDate: form.get('anchorDate'),
    platoons: Object.fromEntries(shiftKeys.map((k) => [k, String(form.get(`platoon.${k}`) ?? '').trim() || undefined])),
    kelly: kellyEvery ? { everyNthShift: kellyEvery } : undefined,
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  return runAdmin('scheduling.config.manage', form, async (tx) => `Saved draft v${await savePatternDraft(tx, parsed.data)}`);
}

export async function approvePattern(version: number, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const effectiveDate = String(form.get('effectiveFrom') ?? '');
  if (!DATE.test(effectiveDate) || Number.isNaN(Date.parse(`${effectiveDate}T00:00:00Z`))) {
    return { ok: false, message: 'Enter the date the new pattern takes effect.', fieldErrors: { effectiveFrom: 'Required' } };
  }
  if (!Number.isInteger(version) || version < 1) return { ok: false, message: 'Unknown draft.' };
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('scheduling')) return MODULE_OFF;
  // Approval cancels generated shifts department-wide, so it also needs department roster edit.
  const roster = check(ctx, 'scheduling.roster.edit');
  if (!roster.allowed) return { ok: false, message: `Not allowed: ${roster.reason}` };
  const today = localDateOf(new Date(), ctx.tenant.timezone);
  let cancelled = 0;
  const result = await runAdmin('admin.config.manage', form, async (tx) => {
    cancelled = (await approvePatternDraft(tx, version, effectiveDate, today)).cancelled;
    return 'Approved';
  });
  if (!result.ok) return result;
  // The draft (and this form) is gone once approved, so report the outcome on the page itself.
  redirect(`/admin/scheduling/patterns?approved=${version}&from=${effectiveDate}&cancelled=${cancelled}`);
}
