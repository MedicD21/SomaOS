'use server';
import { localPlusHoursToInstant, localToInstant } from '@soma/schedule-engine';
import { cancelOpenShiftSchema, claimOpenShiftSchema, decideClaimSchema, postOpenShiftSchema } from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { ActionError, runScoped, zodFieldErrors } from '@/server/actions';
import { loadSeats } from '@/server/scheduling/load';
import { claimQualification } from '@/server/scheduling/open-shifts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Posts an unfilled seat and time as an open shift; the database checks the officer covers the seat's station. */
export async function postOpenShift(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = postOpenShiftSchema.safeParse({ seatId: form.get('seatId'), type: form.get('type'), reason: form.get('reason') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const date = String(form.get('date') ?? '');
  const startTime = String(form.get('startTime') ?? '');
  const hours = Number(form.get('hours'));
  if (!DATE.test(date) || !TIME.test(startTime)) return { ok: false, message: 'Enter the date and a start time as HH:MM.', fieldErrors: { date: 'Enter the date and start time' } };
  if (!Number.isInteger(hours) || hours < 1 || hours > 48) return { ok: false, message: 'Hours must be a whole number from 1 to 48.', fieldErrors: { hours: 'Whole hours, 1 to 48' } };
  const v = parsed.data;
  return runScoped(['scheduling.roster.edit'], async (tx) => {
    const [seat] = await loadSeats(tx, { seatId: v.seatId });
    if (!seat) throw new ActionError('That seat no longer exists.');
    const start = localToInstant(date, startTime, seat.tz).toISOString();
    const end = localPlusHoursToInstant(date, startTime, hours, seat.tz).toISOString();
    await tx`select app.post_open_shift(${v.seatId}, ${start}::timestamptz, ${end}::timestamptz, ${v.type}, ${v.reason})`;
    return 'Open shift posted.';
  });
}

export async function cancelOpenShift(id: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = cancelOpenShiftSchema.safeParse({ id, reason: form.get('reason') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped(['scheduling.roster.edit'], async (tx) => {
    await tx`select app.cancel_open_shift(${v.id}, ${v.reason})`;
    return 'Open shift cancelled.';
  });
}

export async function claimOpenShift(id: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = claimOpenShiftSchema.safeParse({ id, note: form.get('note') ?? undefined });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped(['scheduling.openshift.claim'], async (tx) => {
    await tx`select app.claim_open_shift(${v.id}, ${v.note})`;
    return 'Claimed. An officer will review it.';
  });
}

export async function withdrawClaim(id: string): Promise<ActionResult> {
  return runScoped(['scheduling.openshift.claim'], async (tx) => {
    await tx`select app.withdraw_claim(${id})`;
    return 'Claim withdrawn.';
  });
}

/** Approve (creating the assignment) or deny. A qualification block needs an override reason from someone allowed to waive it. */
export async function decideClaim(id: string, approve: boolean, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = decideClaimSchema.safeParse({ id, approve, note: form.get('note') ?? undefined, overrideReason: String(form.get('overrideReason') ?? '').trim() || undefined });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped(['scheduling.roster.edit'], async (tx) => {
    let override: string | null = null;
    let acting = false;
    if (v.approve) {
      const q = await claimQualification(tx, v.id);
      acting = q.acting;
      if (q.blocks.length > 0) {
        if (!v.overrideReason) throw new ActionError(`This claim is blocked: ${q.blocks.join('; ')}. Add an override reason to approve it anyway.`);
        override = v.overrideReason;
      }
    }
    await tx`select app.decide_claim(${v.id}, ${v.approve}, ${v.note}, ${override}, ${acting})`;
    return v.approve ? 'Claim approved. The shift is on their schedule.' : 'Claim denied.';
  });
}
