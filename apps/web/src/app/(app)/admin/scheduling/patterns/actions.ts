'use server';
import { redirect } from 'next/navigation';
import { localDateOf, type ShiftPattern } from '@soma/schedule-engine';
import { issuesToFieldErrors, shiftPatternSchema } from '@soma/validators';
import { z } from 'zod';
import type { ActionResult } from '@/server/actions';
import { runAdmin, zodFieldErrors } from '@/server/actions';
import type { SimState } from '@/components/rule-builder/sim-types';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { PATTERN_KEY, approvePatternDraft, savePatternDraft } from '@/server/scheduling/patterns';
import { requireSimulation } from '@/server/rules/guard';
import { runSimulation } from '@/server/rules/run';
import { simulatePattern, todayIn } from '@/server/rules/simulate';

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
  // Approval supersedes generated shifts department-wide, so it also needs department roster edit.
  const roster = check(ctx, 'scheduling.roster.edit');
  if (!roster.allowed) return { ok: false, message: `Not allowed: ${roster.reason}` };
  const today = localDateOf(new Date(), ctx.tenant.timezone);
  let superseded = 0;
  const token = String(form.get('simToken') ?? '');
  const result = await runAdmin('admin.config.manage', form, async (tx, c) => {
    // The draft must be valid (known shifts, an offset for each) and simulated, exactly as stored, by this user.
    const note = await requireSimulation(tx, { tenantId: c.tenant.id, userId: c.userId }, 'schedule.pattern', PATTERN_KEY, version, token);
    superseded = (await approvePatternDraft(tx, version, effectiveDate, today, note)).superseded;
    return 'Approved';
  });
  if (!result.ok) return result;
  // The draft (and this form) is gone once approved, so report the outcome on the page itself.
  redirect(`/admin/scheduling/patterns?approved=${version}&from=${effectiveDate}&replaced=${superseded}`);
}

const simSchema = z.object({
  shiftKey: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Choose a shift'),
  from: z.union([z.iso.date(), z.literal('')]).default(''),
  weeks: z.coerce.number().int().min(1).max(12).default(8),
});

/** Shows the saved draft next to the approved pattern for one shift, day by day. Writes nothing. */
export async function simulatePatternDraft(version: number, _prev: SimState, form: FormData): Promise<SimState> {
  if (!Number.isInteger(version) || version < 1) return { ok: false, message: 'Unknown draft.' };
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('scheduling')) return { ok: false, message: 'Scheduling is not enabled for this department.' };
  const parsed = simSchema.safeParse(Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : ''])));
  if (!parsed.success) return { ok: false, message: 'Check the simulation inputs.', fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  const v = parsed.data;
  return runSimulation({
    kind: 'schedule.pattern',
    key: PATTERN_KEY,
    version,
    allowed: (c) => check(c, 'scheduling.config.manage').allowed,
    run: (tx, c, draft) =>
      simulatePattern(tx, { draft: draft as ShiftPattern, today: todayIn(c.tenant.timezone), tz: c.tenant.timezone, shiftKey: v.shiftKey, from: v.from || null, weeks: v.weeks }),
  });
}
