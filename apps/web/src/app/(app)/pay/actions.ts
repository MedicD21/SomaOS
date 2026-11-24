'use server';
import { closePeriodSchema, reopenPeriodSchema } from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { ActionError, runAdmin, zodFieldErrors } from '@/server/actions';
import { closePayPeriod, reopenPayPeriod } from '@/server/pay/close';
import { payPeriodFor } from '@/server/pay/load';

/** Freezes the pay period that starts on `start`, credits comp time and locks it. */
export async function closePeriod(start: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = closePeriodSchema.safeParse({ start });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  return runAdmin('pay.manage', form, async (tx) => {
    const period = await payPeriodFor(tx, parsed.data.start);
    if (!period || period.start !== parsed.data.start) throw new ActionError('That is not the start of a pay period.');
    const { credits } = await closePayPeriod(tx, period);
    const hours = Math.round(credits.reduce((s, c) => s + c.hours, 0) * 100) / 100;
    return credits.length ? `Pay period closed. Credited ${hours} h of comp time to ${credits.length} member${credits.length === 1 ? '' : 's'}.` : 'Pay period closed.';
  });
}

export async function reopenPeriod(id: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = reopenPeriodSchema.safeParse({ id, reason: form.get('reason') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  return runAdmin('pay.manage', form, async (tx) => {
    await reopenPayPeriod(tx, parsed.data.id, parsed.data.reason);
    return 'Pay period reopened. Comp time credited at close was reversed.';
  });
}
