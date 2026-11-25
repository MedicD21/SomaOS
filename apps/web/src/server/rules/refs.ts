import 'server-only';
import type { AccrualPolicy, PayRules, ShiftPattern } from '@soma/schedule-engine';
import { WORK_TYPES } from '@soma/schedule-engine';
import type { Tx } from '@/server/db';

export type RefIssue = { path: string; message: string };

/**
 * Checks that a draft points at things that really exist in this department (read-only). These are hard
 * errors when approving: a rule that names a missing pay code or comp bank would pay or accrue wrongly.
 */
export async function payRulesRefs(tx: Tx, r: PayRules): Promise<RefIssue[]> {
  const codes = new Map((await tx<{ key: string; archived: boolean }[]>`select key, archived_at is not null as archived from pay_codes`).map((c) => [c.key, c.archived]));
  const issues: RefIssue[] = [];
  const need = (path: string, code: string): void => {
    if (!codes.has(code)) issues.push({ path, message: `There is no pay code "${code}". Add it under Pay codes first.` });
    else if (codes.get(code)) issues.push({ path, message: `The pay code "${code}" is archived.` });
  };
  need('workPeriod.code', r.workPeriod.code);
  for (const t of WORK_TYPES) need(`assignments.${t}.code`, r.assignments[t].code);
  if (r.compTime.mode !== 'never' && r.compTime.bankKey) {
    const banks = await tx<{ key: string; archived: boolean }[]>`select key, archived_at is not null as archived from leave_banks where key = ${r.compTime.bankKey}`;
    if (banks.length === 0) issues.push({ path: 'compTime.bankKey', message: `There is no leave bank "${r.compTime.bankKey}". Add it under Leave banks first.` });
    else if (banks[0]!.archived) issues.push({ path: 'compTime.bankKey', message: `The leave bank "${r.compTime.bankKey}" is archived.` });
  }
  return issues;
}

/** The policy belongs to a leave bank; the bank must exist and be active. */
export async function accrualRefs(tx: Tx, bankKey: string, _p: AccrualPolicy): Promise<RefIssue[]> {
  const [bank] = await tx<{ archived: boolean }[]>`select archived_at is not null as archived from leave_banks where key = ${bankKey}`;
  if (!bank) return [{ path: '', message: `There is no leave bank "${bankKey}".` }];
  if (bank.archived) return [{ path: '', message: `The leave bank "${bankKey}" is archived.` }];
  return [];
}

/** Every platoon key must be a department shift, and every department shift needs an offset. */
export async function patternRefs(tx: Tx, p: ShiftPattern): Promise<RefIssue[]> {
  const shifts = (await tx<{ key: string; label: string }[]>`select key, label from shifts`).map((s) => s);
  const known = new Set(shifts.map((s) => s.key));
  const issues: RefIssue[] = [];
  for (const k of Object.keys(p.platoons)) {
    if (!known.has(k)) issues.push({ path: `platoons.${k}`, message: `"${k}" is not one of this department's shifts.` });
  }
  for (const s of shifts) {
    if (p.platoons[s.key] === undefined) issues.push({ path: `platoons.${s.key}`, message: `${s.label} needs an offset.` });
  }
  return issues;
}
