'use server';
import { decideTradeSchema, proposeTradeSchema } from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { ActionError, runScoped, zodFieldErrors } from '@/server/actions';
import { tradeBlocks } from '@/server/scheduling/trades';

export async function proposeTrade(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = proposeTradeSchema.safeParse({ mineId: form.get('mineId'), theirsId: form.get('theirsId'), note: form.get('note') ?? undefined });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped(['scheduling.trade.request'], async (tx) => {
    await tx`select app.request_trade(${v.mineId}, ${v.theirsId}, ${v.note})`;
    return 'Trade proposed. They will be asked to accept.';
  });
}

export async function respondTrade(id: string, accept: boolean): Promise<ActionResult> {
  return runScoped(['scheduling.trade.request'], async (tx) => {
    await tx`select app.respond_trade(${id}, ${accept})`;
    return accept ? 'Accepted. An officer will review the trade.' : 'Declined.';
  });
}

export async function withdrawTrade(id: string): Promise<ActionResult> {
  return runScoped(['scheduling.trade.request'], async (tx) => {
    await tx`select app.cancel_trade(${id})`;
    return 'Trade withdrawn.';
  });
}

/** Approve (swap the shifts) or deny. Qualification blocks need an override reason from someone allowed to waive them. */
export async function decideTrade(id: string, approve: boolean, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = decideTradeSchema.safeParse({ id, approve, note: form.get('note') ?? undefined, overrideReason: String(form.get('overrideReason') ?? '').trim() || undefined });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped(['scheduling.roster.edit'], async (tx) => {
    let override: string | null = null;
    if (v.approve) {
      const blocks = await tradeBlocks(tx, v.id);
      if (blocks.length > 0) {
        if (!v.overrideReason) throw new ActionError(`This trade is blocked: ${blocks.join('; ')}. Add an override reason to approve it anyway.`);
        override = v.overrideReason;
      }
    }
    await tx`select app.decide_trade(${v.id}, ${v.approve}, ${v.note}, ${override})`;
    return v.approve ? 'Trade approved. The roster is updated.' : 'Trade denied.';
  });
}
