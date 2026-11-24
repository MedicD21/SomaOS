'use server';
import { revalidatePath } from 'next/cache';
import { leaveRequestSchema } from '@soma/validators';
import { z } from 'zod';
import type { ActionResult } from '@/server/actions';
import { friendlyDbError, zodFieldErrors } from '@/server/actions';
import { getRequestContext, withCtxDb } from '@/server/context';

const MODULE_OFF: ActionResult = { ok: false, message: 'Leave is not enabled for this department.' };

export async function requestLeave(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('leave')) return MODULE_OFF;
  const parsed = leaveRequestSchema.safeParse({
    leaveTypeId: form.get('leaveTypeId'),
    startDate: form.get('startDate'),
    endDate: form.get('endDate'),
    reason: form.get('reason'),
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  try {
    const hours = await withCtxDb(ctx, async (tx) => {
      const [r] = await tx<{ id: string }[]>`
        select app.request_leave(${v.leaveTypeId}, ${v.startDate}::date, ${v.endDate}::date, ${v.reason}) as id`;
      const [h] = await tx<{ hours: number }[]>`select hours::float8 as hours from leave_requests where id = ${r!.id}`;
      return h!.hours;
    });
    revalidatePath('/leave');
    return { ok: true, message: `Requested ${hours} h of leave — waiting for approval.` };
  } catch (e) {
    return { ok: false, message: friendlyDbError(e) };
  }
}

export async function cancelLeave(requestId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('leave')) return MODULE_OFF;
  const id = z.uuid().safeParse(requestId);
  if (!id.success) return { ok: false, message: 'Request not found.' };
  const note = String(form.get('note') ?? '').trim() || null;
  try {
    await withCtxDb(ctx, (tx) => tx`select app.cancel_leave(${id.data}, ${note})`);
    revalidatePath('/leave');
    return { ok: true, message: 'Cancelled.' };
  } catch (e) {
    return { ok: false, message: friendlyDbError(e) };
  }
}
