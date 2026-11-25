import 'server-only';
import type { AccrualPolicy, PayRules, ShiftPattern } from '@soma/schedule-engine';
import { accrualPolicySchema, issuesToFieldErrors, payRulesSchema, shiftPatternSchema } from '@soma/validators';
import type { Tx } from '@/server/db';
import { ActionError } from '@/server/errors';
import { accrualRefs, patternRefs, payRulesRefs, type RefIssue } from './refs';
import { signSimulation, verifySimulation } from './sim-token';

export type RuleKind = 'pay.rules' | 'leave.accrual' | 'schedule.pattern';

/** Approving a rule document needs a simulation of exactly that draft. One switch, easy to relax later. */
export const SIMULATION_REQUIRED = true;

export type DraftRow = { id: string; version: number; payload: unknown };

export async function loadDraft(tx: Tx, kind: RuleKind, key: string, version: number): Promise<DraftRow | null> {
  const [row] = await tx<DraftRow[]>`
    select id, version, payload from config_versions
    where tenant_id = app.tenant_id() and kind = ${kind} and key = ${key} and status = 'draft' and version = ${version}`;
  return row ?? null;
}

/** The latest open draft of a document, if any. */
export async function latestDraft(tx: Tx, kind: RuleKind, key: string): Promise<DraftRow | null> {
  const [row] = await tx<DraftRow[]>`
    select id, version, payload from config_versions
    where tenant_id = app.tenant_id() and kind = ${kind} and key = ${key} and status = 'draft'
    order by version desc limit 1`;
  return row ?? null;
}

export type DraftCheck =
  | { ok: true; value: PayRules | AccrualPolicy | ShiftPattern }
  | { ok: false; errors: Record<string, string> };

/** The schema first, then references to things that must exist in this department. */
export async function checkDraft(tx: Tx, kind: RuleKind, key: string, payload: unknown): Promise<DraftCheck> {
  const schema = kind === 'pay.rules' ? payRulesSchema : kind === 'leave.accrual' ? accrualPolicySchema : shiftPatternSchema;
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { ok: false, errors: issuesToFieldErrors(parsed.error.issues) };
  let refs: RefIssue[] = [];
  if (kind === 'pay.rules') refs = await payRulesRefs(tx, parsed.data as PayRules);
  else if (kind === 'leave.accrual') refs = await accrualRefs(tx, key);
  else refs = await patternRefs(tx, parsed.data as ShiftPattern);
  if (refs.length > 0) {
    const errors: Record<string, string> = {};
    for (const r of refs) errors[r.path] ??= r.message;
    return { ok: false, errors };
  }
  return { ok: true, value: parsed.data as PayRules | AccrualPolicy | ShiftPattern };
}

export const firstError = (errors: Record<string, string>): string => {
  const [path, message] = Object.entries(errors)[0] ?? ['', 'Check the values.'];
  return path ? `${path}: ${message}` : message;
};

type Who = { tenantId: string; userId: string };

/** Signs a token for a draft that has just been simulated. */
export function simulationTokenFor(who: Who, kind: RuleKind, key: string, draft: DraftRow, summary: string): string {
  return signSimulation({ tenantId: who.tenantId, kind, key, version: draft.version, userId: who.userId, payload: draft.payload, summary });
}

/**
 * Server-side approval guard: the draft must still exist, pass its schema and reference checks, and carry a
 * valid simulation token for exactly this draft, this user and this version. Returns text for the audit reason.
 */
export async function requireSimulation(tx: Tx, who: Who, kind: RuleKind, key: string, version: number, token: string): Promise<string> {
  const draft = await loadDraft(tx, kind, key, version);
  if (!draft) throw new ActionError(`Draft v${version} no longer exists. Reload the page.`);
  const check = await checkDraft(tx, kind, key, draft.payload);
  if (!check.ok) throw new ActionError(`This draft cannot be approved yet. ${firstError(check.errors)}`);
  if (!SIMULATION_REQUIRED) return '';
  const verdict = verifySimulation(token, { tenantId: who.tenantId, kind, key, version, userId: who.userId, payload: draft.payload });
  if (verdict.ok) return ` Simulated ${verdict.simulatedAt.toISOString()}: ${verdict.summary} (check ${verdict.ref}).`;
  throw new ActionError(
    verdict.reason === 'missing' ? 'Simulate this exact draft first.'
    : verdict.reason === 'expired' ? 'That simulation has expired. Simulate this draft again.'
    : verdict.reason === 'changed' ? 'The draft changed since you simulated it. Simulate it again.'
    : 'That simulation is not valid. Simulate this draft again.',
  );
}
