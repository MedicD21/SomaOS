import 'server-only';
import type { AccrualPolicy, PayRules, ShiftPattern } from '@soma/schedule-engine';
import type { SimResult, SimState } from '@/components/rule-builder/sim-types';
import { friendlyDbError } from '@/server/actions';
import type { RequestContext } from '@/server/context';
import { getRequestContext, withCtxDb } from '@/server/context';
import type { Tx } from '@/server/db';
import { checkDraft, firstError, loadDraft, simulationTokenFor, type RuleKind } from './guard';

/**
 * Runs one read-only simulation of a saved draft for a server action: permission, draft exists and is valid,
 * run the engines, sign a token for exactly this draft. Writes nothing.
 */
export async function runSimulation(opts: {
  kind: RuleKind;
  key: string;
  version: number;
  /** Same permission as seeing the real result. */
  allowed: (ctx: RequestContext) => boolean;
  run: (tx: Tx, ctx: RequestContext, value: PayRules | AccrualPolicy | ShiftPattern) => Promise<{ sim: SimResult; summary: string }>;
}): Promise<SimState> {
  const ctx = await getRequestContext();
  if (!opts.allowed(ctx)) return { ok: false, message: 'Not allowed to simulate this.' };
  try {
    return await withCtxDb(ctx, async (tx): Promise<SimState> => {
      const draft = await loadDraft(tx, opts.kind, opts.key, opts.version);
      if (!draft) return { ok: false, message: `Draft v${opts.version} no longer exists. Reload the page.` };
      const check = await checkDraft(tx, opts.kind, opts.key, draft.payload);
      if (!check.ok) return { ok: false, message: `Fix the draft first. ${firstError(check.errors)}`, fieldErrors: check.errors };
      const { sim, summary } = await opts.run(tx, ctx, check.value);
      const token = simulationTokenFor({ tenantId: ctx.tenant.id, userId: ctx.userId }, opts.kind, opts.key, draft, summary);
      const at = new Intl.DateTimeFormat('en-US', { timeZone: ctx.tenant.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
      return { ok: true, message: `Simulated draft v${opts.version} at ${at}.`, sim, token, simulatedAt: at };
    });
  } catch (e) {
    return { ok: false, message: friendlyDbError(e) };
  }
}
