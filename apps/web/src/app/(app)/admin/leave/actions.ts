'use server';
import { earnForPeriod, type AccrualFacts } from '@soma/schedule-engine';
import { adjustmentSchema, bankSchema, leaveLimitSchema, leaveTypeSchema, parseAccrualPolicyJson } from '@soma/validators';
import { z } from 'zod';
import type { ActionResult } from '@/server/actions';
import { runAdmin, zodFieldErrors } from '@/server/actions';
import { check, getRequestContext } from '@/server/context';
import { approvePolicyDraft, savePolicyDraft } from '@/server/leave/policies';
import { periods } from './preview-periods';

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
  const parsed = parseAccrualPolicyJson(String(form.get('policy') ?? ''));
  if (!parsed.ok) return { ok: false, message: parsed.error, fieldErrors: { policy: parsed.error } };
  return runAdmin('leave.manage', form, async (tx) => `Saved draft v${await savePolicyDraft(tx, bankKey, parsed.policy)}`);
}

export async function approvePolicy(bankKey: string, version: number, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const effectiveDate = String(form.get('effectiveFrom') ?? '');
  if (!KEY.test(bankKey) || !Number.isInteger(version)) return { ok: false, message: 'Unknown leave policy.' };
  if (!ISO.test(effectiveDate)) return { ok: false, message: 'Enter the date this policy takes effect.', fieldErrors: { effectiveFrom: 'Required' } };
  // Approving changes what members earn, so it needs both leave and configuration authority.
  const ctx = await getRequestContext();
  const d = check(ctx, 'leave.manage');
  if (!d.allowed) return { ok: false, message: `Not allowed: ${d.reason}` };
  return runAdmin('admin.config.manage', form, async (tx) => {
    await approvePolicyDraft(tx, bankKey, version, effectiveDate);
    return `Approved v${version} from ${effectiveDate}`;
  });
}

const previewSchema = z.object({
  hireDate: z.union([z.iso.date(), z.literal('')]),
  employmentType: z.string().trim().min(1).max(40),
  periodStart: z.iso.date(),
  hoursWorked: z.coerce.number().min(0).max(10_000),
  balance: z.coerce.number().min(-10_000).max(100_000),
});

/** "What would this member earn?" — runs the engine on the policy text without saving anything. */
export async function previewPolicy(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await getRequestContext();
  const d = check(ctx, 'leave.manage');
  if (!d.allowed) return { ok: false, message: `Not allowed: ${d.reason}` };
  const policy = parseAccrualPolicyJson(String(form.get('policy') ?? ''));
  if (!policy.ok) return { ok: false, message: policy.error, fieldErrors: { policy: policy.error } };
  const parsed = previewSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  const period = periods(policy.policy.period, v.periodStart);
  const facts: AccrualFacts = {
    hireDate: v.hireDate || null, employmentType: v.employmentType, hoursWorked: v.hoursWorked, balance: v.balance, separatedOn: null,
  };
  const r = earnForPeriod(policy.policy, facts, period);
  const why = r.explain.map((e) => e.message).join(' ');
  return { ok: true, message: `${r.hours} h earned for ${period.start} to ${period.endExclusive}. ${why}` };
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
