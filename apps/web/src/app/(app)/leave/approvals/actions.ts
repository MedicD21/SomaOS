'use server';
import { revalidatePath } from 'next/cache';
import { overrideReasonSchema } from '@soma/validators';
import { z } from 'zod';
import type { ActionResult } from '@/server/actions';
import { friendlyDbError, zodFieldErrors } from '@/server/actions';
import { getRequestContext, withCtxDb } from '@/server/context';

export async function decideLeave(requestId: string, approve: boolean, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('leave')) return { ok: false, message: 'Leave is not enabled for this department.' };
  const id = z.uuid().safeParse(requestId);
  if (!id.success) return { ok: false, message: 'Request not found.' };
  const note = String(form.get('note') ?? '').trim() || null;
  // A reason is only sent when the approver typed one; the database decides whether a limit actually needs it.
  const rawOverride = String(form.get('overrideReason') ?? '').trim();
  let override: string | null = null;
  if (approve && rawOverride) {
    const parsed = overrideReasonSchema.safeParse(rawOverride);
    if (!parsed.success) return zodFieldErrors([{ path: ['overrideReason'], message: parsed.error.issues[0]!.message }]);
    override = parsed.data;
  }
  try {
    await withCtxDb(ctx, (tx) => tx`select app.decide_leave(${id.data}, ${approve}, ${note}, ${override})`);
    revalidatePath('/leave/approvals');
    return { ok: true, message: approve ? 'Approved.' : 'Denied.' };
  } catch (e) {
    return { ok: false, message: friendlyDbError(e) };
  }
}
