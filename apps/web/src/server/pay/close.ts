import 'server-only';
import type { Tx } from '@/server/db';
import { ActionError } from '@/server/errors';
import { calculatePayPeriod, type Period } from './load';

export type CompCredit = { memberId: string; name: string; bankKey: string; hours: number };

/** Comp time the pay engine says each member earned in the period (what closing will credit). */
export function compCredits(rows: Awaited<ReturnType<typeof calculatePayPeriod>>['rows']): CompCredit[] {
  return rows.flatMap((r) =>
    r.result?.comp.bankKey && r.result.comp.hours > 0
      ? [{ memberId: r.memberId, name: r.name, bankKey: r.result.comp.bankKey, hours: r.result.comp.hours }]
      : [],
  );
}

/**
 * Closes a pay period: recalculates it, refuses when any member could not be calculated (nothing is
 * guessed), freezes the numbers and credits comp time to the leave ledger, all in one database call.
 */
export async function closePayPeriod(tx: Tx, period: Period): Promise<{ id: string; credits: CompCredit[] }> {
  const live = await calculatePayPeriod(tx, period);
  const problems = live.rows.filter((r) => r.problem);
  if (problems.length > 0) {
    const first = problems[0]!;
    throw new ActionError(
      `Cannot close: ${problems.length} member${problems.length === 1 ? '' : 's'} could not be calculated (${first.name}: ${first.problem}) Fix this first.`,
    );
  }
  const credits = compCredits(live.rows);
  const snapshot = { period: live.period, rows: live.rows };
  const comp = credits.map((c) => ({ member_id: c.memberId, bank_key: c.bankKey, hours: c.hours }));
  const [row] = await tx<{ id: string }[]>`
    select app.close_pay_period(${period.start}::date, ${period.endExclusive}::date, ${tx.json(snapshot as never)}, ${tx.json(comp as never)}) as id`;
  return { id: row!.id, credits };
}

export async function reopenPayPeriod(tx: Tx, closeId: string, reason: string): Promise<void> {
  await tx`select app.reopen_pay_period(${closeId}, ${reason})`;
}
