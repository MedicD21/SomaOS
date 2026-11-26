import 'server-only';
import type { RequestContext } from '@/server/context';
import { hasAny } from '@/server/context';

/** What the caller holds, in any scope. The database decides the scope on every read and write. */
export function custodyAccess(ctx: RequestContext) {
  const record = hasAny(ctx, 'custody.record');
  const witness = hasAny(ctx, 'custody.witness');
  const audit = hasAny(ctx, 'custody.audit');
  const manage = hasAny(ctx, 'custody.manage');
  return { enabled: ctx.tenant.enabledModules.includes('custody'), record, witness, audit, manage, any: record || witness || audit || manage };
}

export const num = (n: number) => String(Math.round(n * 1000) / 1000);
export const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');
