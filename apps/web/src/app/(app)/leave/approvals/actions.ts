'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/server/actions';
import { friendlyDbError } from '@/server/actions';
import { getRequestContext, withCtxDb } from '@/server/context';

export async function decideLeave(requestId: string, approve: boolean, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('leave')) return { ok: false, message: 'Leave is not enabled for this department.' };
  const id = z.uuid().safeParse(requestId);
  if (!id.success) return { ok: false, message: 'Request not found.' };
  const note = String(form.get('note') ?? '').trim() || null;
  try {
    await withCtxDb(ctx, (tx) => tx`select app.decide_leave(${id.data}, ${approve}, ${note})`);
    revalidatePath('/leave/approvals');
    return { ok: true, message: approve ? 'Approved.' : 'Denied.' };
  } catch (e) {
    return { ok: false, message: friendlyDbError(e) };
  }
}
