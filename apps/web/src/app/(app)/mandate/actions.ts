'use server';
import { redirect } from 'next/navigation';
import { localPlusHoursToInstant, localToInstant } from '@soma/schedule-engine';
import {
  createMandateListSchema,
  mandateExemptSchema,
  mandateMemberSchema,
  mandateRecordSchema,
  mandateRemoveSchema,
  mandateReorderSchema,
  mandateSkipSchema,
} from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { ActionError, runScoped, zodFieldErrors } from '@/server/actions';
import { loadSeats } from '@/server/scheduling/load';
import { mandateQualification } from '@/server/scheduling/mandate';

const MANAGE = ['scheduling.mandate.manage'] as const;

export async function createMandateList(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = createMandateListSchema.safeParse({ name: form.get('name') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  let id = '';
  const result = await runScoped([...MANAGE], async (tx) => {
    const [row] = await tx<{ id: string }[]>`select app.create_mandate_list(${parsed.data.name}) as id`;
    id = row!.id;
    return 'List created.';
  });
  if (!result.ok) return result;
  redirect(`/mandate?list=${id}`);
}

export async function addToMandateList(listId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = mandateMemberSchema.safeParse({ listId, memberId: form.get('memberId') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped([...MANAGE], async (tx) => {
    await tx`select app.mandate_add(${v.listId}, ${v.memberId})`;
    return 'Added to the bottom of the list.';
  });
}

export async function removeFromMandateList(listId: string, memberId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = mandateRemoveSchema.safeParse({ listId, memberId, reason: form.get('reason') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped([...MANAGE], async (tx) => {
    await tx`select app.mandate_remove(${v.listId}, ${v.memberId}, ${v.reason})`;
    return 'Removed from the list.';
  });
}

/** Saves a new order; `order` is the full list of member ids, top first. */
export async function reorderMandateList(listId: string, order: string[], _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = mandateReorderSchema.safeParse({ listId, order, reason: form.get('reason') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped([...MANAGE], async (tx) => {
    await tx`select app.mandate_reorder(${v.listId}, ${v.order}::uuid[], ${v.reason})`;
    return 'New order saved.';
  });
}

export async function exemptFromMandate(listId: string, memberId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = mandateExemptSchema.safeParse({ listId, memberId, reason: form.get('reason'), until: form.get('until') ?? '' });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped([...MANAGE], async (tx) => {
    await tx`select app.mandate_set_exempt(${v.listId}, ${v.memberId}, ${v.reason}, ${v.until}::date)`;
    return 'Exemption saved.';
  });
}

export async function clearMandateExemption(listId: string, memberId: string): Promise<ActionResult> {
  const parsed = mandateMemberSchema.safeParse({ listId, memberId });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  return runScoped([...MANAGE], async (tx) => {
    await tx`select app.mandate_set_exempt(${listId}, ${memberId}, null, null)`;
    return 'Exemption cleared.';
  });
}

export async function skipForMandate(listId: string, memberId: string, date: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = mandateSkipSchema.safeParse({ listId, memberId, reason: form.get('reason'), date });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped([...MANAGE], async (tx) => {
    await tx`select app.mandate_skip(${v.listId}, ${v.memberId}, ${v.reason}, ${v.date}::date)`;
    return 'Skipped for this date. Their place on the list is kept.';
  });
}

/**
 * Mandates a member into a seat: the database creates the overtime shift, rotates them to the bottom
 * and logs it. A qualification block needs an override reason from someone allowed to waive it.
 */
export async function recordMandate(listId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = mandateRecordSchema.safeParse({
    listId,
    memberId: form.get('memberId'),
    seatId: form.get('seatId'),
    date: form.get('date'),
    startTime: form.get('startTime'),
    hours: form.get('hours'),
    reason: form.get('reason') ?? undefined,
    overrideReason: String(form.get('overrideReason') ?? '').trim() || undefined,
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped([...MANAGE], async (tx) => {
    const [seat] = await loadSeats(tx, { seatId: v.seatId });
    if (!seat) throw new ActionError('That seat no longer exists.');
    const start = localToInstant(v.date, v.startTime, seat.tz);
    const end = localPlusHoursToInstant(v.date, v.startTime, v.hours, seat.tz);
    let override: string | null = null;
    const blocks = await mandateQualification(tx, v.memberId, v.seatId, end);
    if (blocks.length > 0) {
      if (!v.overrideReason) throw new ActionError(`Blocked: ${blocks.join('; ')}. Add an override reason to mandate anyway.`);
      override = v.overrideReason;
    }
    await tx`select app.mandate_record(${v.listId}, ${v.memberId}, ${v.seatId}, ${start.toISOString()}::timestamptz,
                                       ${end.toISOString()}::timestamptz, ${v.reason}, ${override})`;
    return 'Mandated. The shift is on their schedule and they moved to the bottom of the list.';
  });
}
