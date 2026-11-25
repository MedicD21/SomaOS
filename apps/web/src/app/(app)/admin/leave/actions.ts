'use server';
import type { AccrualPolicy } from '@soma/schedule-engine';
import { accrualPolicySchema, adjustmentSchema, bankSchema, issuesToFieldErrors, leaveLimitSchema, leaveTypeSchema, parseJsonDocument, unknownPaths } from '@soma/validators';
import { z } from 'zod';
import type { ActionResult } from '@/server/actions';
import { runAdmin, zodFieldErrors } from '@/server/actions';
import type { SimState } from '@/components/rule-builder/sim-types';
import { check, getRequestContext } from '@/server/context';
import { approvePolicyDraft, savePolicyDraft } from '@/server/leave/policies';
import { requireSimulation } from '@/server/rules/guard';
import { runSimulation } from '@/server/rules/run';
import { simulateAccrual, todayIn } from '@/server/rules/simulate';

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function addBank(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = bankSchema.safeParse({ label: form.get('label'), key: form.get('key') ?? '' });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('leave.manage', form, async (tx) => {
    await tx`insert into leave_banks (tenant_id, key, label) values (app.tenant_id(), ${v.key}, ${v.label})`;
    return `Added ${v.label}`;
  });
}

export async function setBankArchived(id: string, archived: boolean, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  return runAdmin('leave.manage', form, async (tx) => {
    await tx`update leave_banks set archived_at = ${archived ? new Date() : null} where id = ${id}`;
    return archived ? 'Archived' : 'Restored';
  });
}

export async function addLeaveType(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = leaveTypeSchema.safeParse({
    label: form.get('label'), key: form.get('key') ?? '', bankId: form.get('bankId'),
    requiresDocumentation: form.get('requiresDocumentation'), countsAsWorked: form.get('countsAsWorked'),
    leadTimeDays: form.get('leadTimeDays') || 0,
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('leave.manage', form, async (tx) => {
    await tx`insert into leave_types (tenant_id, key, label, bank_id, requires_documentation, lead_time_days, counts_as_worked, sort)
             values (app.tenant_id(), ${v.key}, ${v.label}, ${v.bankId}, ${v.requiresDocumentation}, ${v.leadTimeDays}, ${v.countsAsWorked},
                     (select coalesce(max(sort), 0) + 1 from leave_types))`;
    return `Added ${v.label}`;
  });
}

export async function setTypeArchived(id: string, archived: boolean, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  return runAdmin('leave.manage', form, async (tx) => {
    await tx`update leave_types set archived_at = ${archived ? new Date() : null} where id = ${id}`;
    return archived ? 'Archived' : 'Restored';
  });
}

export async function savePolicy(bankKey: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  if (!KEY.test(bankKey)) return { ok: false, message: 'Unknown leave bank.' };
  const doc = parseJsonDocument(String(form.get('policy') ?? ''));
  if (!doc.ok) return { ok: false, message: doc.error, fieldErrors: { policy: doc.error } };
  const parsed = accrualPolicySchema.safeParse(doc.value);
  if (!parsed.success) {
    const fieldErrors = issuesToFieldErrors(parsed.error.issues);
    const [path, message] = Object.entries(fieldErrors)[0]!;
    return { ok: false, message: `${path ? `${path}: ` : ''}${message}`, fieldErrors };
  }
  // Settings the policy does not use are kept in the stored document (engines ignore them) and reported.
  const extra = unknownPaths(doc.value, parsed.data);
  return runAdmin('leave.manage', form, async (tx) => {
    const v = await savePolicyDraft(tx, bankKey, doc.value as AccrualPolicy);
    return `Saved draft v${v}${extra.length ? `. Kept settings this policy does not use: ${extra.join(', ')}` : ''}`;
  });
}

export async function approvePolicy(bankKey: string, version: number, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const effectiveDate = String(form.get('effectiveFrom') ?? '');
  if (!KEY.test(bankKey) || !Number.isInteger(version)) return { ok: false, message: 'Unknown leave policy.' };
  if (!ISO.test(effectiveDate)) return { ok: false, message: 'Enter the date this policy takes effect.', fieldErrors: { effectiveFrom: 'Required' } };
  // Approving changes what members earn, so it needs both leave and configuration authority.
  const ctx = await getRequestContext();
  const d = check(ctx, 'leave.manage');
  if (!d.allowed) return { ok: false, message: `Not allowed: ${d.reason}` };
  const token = String(form.get('simToken') ?? '');
  return runAdmin('admin.config.manage', form, async (tx, c) => {
    // The draft must be valid and simulated, exactly as it is stored now, by this user.
    const note = await requireSimulation(tx, { tenantId: c.tenant.id, userId: c.userId }, 'leave.accrual', bankKey, version, token);
    await approvePolicyDraft(tx, bankKey, version, effectiveDate, note);
    return `Approved v${version} from ${effectiveDate}`;
  });
}

const simSchema = z.object({
  memberId: z.union([z.uuid(), z.literal('')]).default(''),
  from: z.union([z.iso.date(), z.literal('')]).default(''),
  hireDate: z.union([z.iso.date(), z.literal('')]).default(''),
  employmentType: z.string().trim().min(1).max(40).default('career_full_time'),
  balance: z.coerce.number().min(-10_000).max(100_000).default(0),
  hoursWorked: z.coerce.number().min(0).max(10_000).default(0),
});

/** Projects the saved draft over the next 12 periods next to the approved policy, for a real member or sample facts. Writes nothing. */
export async function simulateAccrualPolicy(bankKey: string, version: number, _prev: SimState, form: FormData): Promise<SimState> {
  if (!KEY.test(bankKey) || !Number.isInteger(version)) return { ok: false, message: 'Unknown leave policy.' };
  const parsed = simSchema.safeParse(Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : ''])));
  if (!parsed.success) return { ok: false, message: 'Check the simulation inputs.', fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  const v = parsed.data;
  return runSimulation({
    kind: 'leave.accrual',
    key: bankKey,
    version,
    allowed: (ctx) => check(ctx, 'leave.manage').allowed,
    run: (tx, ctx, draft) =>
      simulateAccrual(tx, {
        bankKey,
        draft: draft as AccrualPolicy,
        today: todayIn(ctx.tenant.timezone),
        from: v.from || null,
        memberId: v.memberId || null,
        sample: { hireDate: v.hireDate || null, employmentType: v.employmentType, balance: v.balance },
        hoursWorkedPerPeriod: v.hoursWorked,
      }),
  });
}

/** Caps how many members may be on approved leave at once (blank station/shift/type = any). */
export async function addLeaveLimit(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = leaveLimitSchema.safeParse({
    label: form.get('label'), orgUnitId: form.get('orgUnitId'), shiftId: form.get('shiftId'), leaveTypeId: form.get('leaveTypeId'),
    maxConcurrent: form.get('maxConcurrent'), effectiveFrom: form.get('effectiveFrom'),
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('leave.manage', form, async (tx) => {
    await tx`insert into leave_limits (tenant_id, label, scope_kind, org_unit_id, shift_id, leave_type_id, max_concurrent, effective)
             values (app.tenant_id(), ${v.label}, ${v.scopeKind}, ${v.orgUnitId}, ${v.shiftId}, ${v.leaveTypeId}, ${v.maxConcurrent},
                     daterange(${v.effectiveFrom}::date, null))`;
    return `Added ${v.label}`;
  });
}

export async function setLimitArchived(id: string, archived: boolean, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  return runAdmin('leave.manage', form, async (tx) => {
    await tx`update leave_limits set archived_at = ${archived ? new Date() : null} where id = ${id}`;
    return archived ? 'Archived' : 'Restored';
  });
}

export async function adjustBalance(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = adjustmentSchema.safeParse({ memberId: form.get('memberId'), bankId: form.get('bankId'), hours: form.get('hours'), note: form.get('note') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('leave.manage', form, async (tx) => {
    await tx`select app.adjust_leave(${v.memberId}, ${v.bankId}, ${v.hours}, ${v.note})`;
    return `Adjusted by ${v.hours > 0 ? '+' : ''}${v.hours} h`;
  });
}
