'use server';
import type { PayRules, WorkType } from '@soma/schedule-engine';
import { employeeGroupSchema, issuesToFieldErrors, parseJsonDocument, payCodeSchema, payRateSchema, payRulesSchema, unknownPaths } from '@soma/validators';
import { z } from 'zod';
import type { ActionResult } from '@/server/actions';
import { ActionError, runAdmin, zodFieldErrors } from '@/server/actions';
import type { SimState } from '@/components/rule-builder/sim-types';
import { check, getRequestContext } from '@/server/context';
import { requireSimulation } from '@/server/rules/guard';
import { runSimulation } from '@/server/rules/run';
import { simulatePay, todayIn } from '@/server/rules/simulate';
import { approveRulesDraft, saveRulesDraft } from '@/server/pay/rules';

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

export async function addPayCode(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = payCodeSchema.safeParse({
    label: form.get('label'), key: form.get('key') ?? '', kind: form.get('kind'), multiplier: form.get('multiplier'),
    countsTowardFlsa: form.get('countsTowardFlsa'), exportCode: form.get('exportCode'),
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('pay.manage', form, async (tx) => {
    await tx`insert into pay_codes (tenant_id, key, label, kind, multiplier, counts_toward_flsa, export_code, sort)
             values (app.tenant_id(), ${v.key}, ${v.label}, ${v.kind}, ${v.multiplier}, ${v.countsTowardFlsa}, ${v.exportCode},
                     (select coalesce(max(sort), 0) + 1 from pay_codes))`;
    return `Added ${v.label}`;
  });
}

export async function setPayCodeArchived(id: string, archived: boolean, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  return runAdmin('pay.manage', form, async (tx) => {
    await tx`update pay_codes set archived_at = ${archived ? new Date() : null} where id = ${id}`;
    return archived ? 'Archived' : 'Restored';
  });
}

export async function addGroup(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = employeeGroupSchema.safeParse({ label: form.get('label'), key: form.get('key') ?? '' });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('pay.manage', form, async (tx) => {
    await tx`insert into employee_groups (tenant_id, key, label) values (app.tenant_id(), ${v.key}, ${v.label})`;
    return `Added ${v.label}`;
  });
}

const assignSchema = z.object({ memberId: z.uuid(), groupId: z.union([z.uuid(), z.literal('')]) });

export async function assignGroup(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = assignSchema.safeParse({ memberId: form.get('memberId'), groupId: form.get('groupId') ?? '' });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('pay.manage', form, async (tx) => {
    const rows = await tx`update members set employee_group_id = ${v.groupId || null} where id = ${v.memberId} returning id`;
    if (rows.length === 0) throw new ActionError('You do not have permission to change that member.');
    return v.groupId ? 'Assigned to the group' : 'Assigned to the default group';
  });
}

/** Sets a new hourly rate from a date, closing the rate in force the day before. */
export async function setRate(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = payRateSchema.safeParse({
    memberId: form.get('memberId'), hourlyRate: form.get('hourlyRate'), effectiveFrom: form.get('effectiveFrom'), note: form.get('note'),
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('pay.manage', form, async (tx) => {
    const [cur] = await tx<{ id: string; from: string }[]>`
      select id, lower(effective)::text as "from" from member_pay_rates
      where member_id = ${v.memberId} and effective @> ${v.effectiveFrom}::date for update`;
    if (cur) {
      if (cur.from >= v.effectiveFrom) throw new ActionError(`Choose a date after ${cur.from}, when the current rate started.`);
      await tx`update member_pay_rates set effective = daterange(lower(effective), ${v.effectiveFrom}::date) where id = ${cur.id}`;
    }
    await tx`insert into member_pay_rates (tenant_id, member_id, hourly_rate, effective, note)
             values (app.tenant_id(), ${v.memberId}, ${v.hourlyRate}, daterange(${v.effectiveFrom}::date, null), ${v.note})`;
    return `Saved ${usd(v.hourlyRate)}/h from ${v.effectiveFrom}`;
  });
}

export async function saveRules(groupKey: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  if (!KEY.test(groupKey)) return { ok: false, message: 'Unknown employee group.' };
  const doc = parseJsonDocument(String(form.get('rules') ?? ''));
  if (!doc.ok) return { ok: false, message: doc.error, fieldErrors: { rules: doc.error } };
  const parsed = payRulesSchema.safeParse(doc.value);
  if (!parsed.success) {
    const fieldErrors = issuesToFieldErrors(parsed.error.issues);
    const [path, message] = Object.entries(fieldErrors)[0]!;
    return { ok: false, message: `${path ? `${path}: ` : ''}${message}`, fieldErrors };
  }
  // Settings the rules do not use are kept in the stored document (engines ignore them) and reported.
  const extra = unknownPaths(doc.value, parsed.data);
  return runAdmin('pay.manage', form, async (tx) => {
    const v = await saveRulesDraft(tx, groupKey, doc.value as PayRules);
    return `Saved draft v${v}${extra.length ? `. Kept settings these rules do not use: ${extra.join(', ')}` : ''}`;
  });
}

export async function approveRules(groupKey: string, version: number, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const effectiveDate = String(form.get('effectiveFrom') ?? '');
  if (!KEY.test(groupKey) || !Number.isInteger(version)) return { ok: false, message: 'Unknown pay rules.' };
  if (!ISO.test(effectiveDate)) return { ok: false, message: 'Enter the date these rules take effect.', fieldErrors: { effectiveFrom: 'Required' } };
  // Approving changes what people are paid: it needs pay and configuration authority.
  const ctx = await getRequestContext();
  const d = check(ctx, 'pay.manage');
  if (!d.allowed) return { ok: false, message: `Not allowed: ${d.reason}` };
  const token = String(form.get('simToken') ?? '');
  return runAdmin('admin.config.manage', form, async (tx, c) => {
    // The draft must be valid and simulated, exactly as it is stored now, by this user.
    const note = await requireSimulation(tx, { tenantId: c.tenant.id, userId: c.userId }, 'pay.rules', groupKey, version, token);
    await approveRulesDraft(tx, groupKey, version, effectiveDate, note);
    return `Approved v${version} from ${effectiveDate}`;
  });
}

const WORK = ['regular', 'overtime', 'trade', 'holdover', 'callback', 'acting', 'training', 'detail'] as const;
const simSchema = z.object({
  mode: z.enum(['period', 'sample']),
  date: z.union([z.iso.date(), z.literal('')]).default(''),
  memberId: z.union([z.uuid(), z.literal('')]).default(''),
  hourlyRate: z.union([z.coerce.number().gt(0).max(1000), z.literal('')]).default(''),
  type1: z.enum(WORK).default('regular'),
  hours1: z.coerce.number().gt(0).max(48).default(24),
  count1: z.coerce.number().int().min(0).max(60).default(0),
  type2: z.enum(WORK).default('callback'),
  hours2: z.coerce.number().gt(0).max(48).default(4),
  count2: z.coerce.number().int().min(0).max(60).default(0),
});

/** Runs the saved draft against real shifts for a period (or made-up shifts) next to the approved rules. Writes nothing. */
export async function simulatePayRules(groupKey: string, version: number, _prev: SimState, form: FormData): Promise<SimState> {
  if (!KEY.test(groupKey) || !Number.isInteger(version)) return { ok: false, message: 'Unknown pay rules.' };
  const parsed = simSchema.safeParse(Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : ''])));
  if (!parsed.success) return { ok: false, message: 'Check the simulation inputs.', fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  const v = parsed.data;
  if (v.mode === 'sample' && v.count1 + v.count2 === 0) return { ok: false, message: 'Enter how many sample shifts to run.', fieldErrors: { count1: 'Enter at least one shift' } };
  return runSimulation({
    kind: 'pay.rules',
    key: groupKey,
    version,
    allowed: (ctx) => check(ctx, 'pay.view').allowed || check(ctx, 'pay.manage').allowed,
    run: (tx, ctx, draft) => {
      const today = todayIn(ctx.tenant.timezone);
      if (v.mode === 'sample') {
        const shifts = [
          { type: v.type1 as WorkType, hours: v.hours1, count: v.count1 },
          { type: v.type2 as WorkType, hours: v.hours2, count: v.count2 },
        ].filter((x) => x.count > 0);
        return simulatePay(tx, { mode: 'sample', groupKey, draft: draft as PayRules, today, hourlyRate: v.hourlyRate === '' ? null : v.hourlyRate, shifts });
      }
      return simulatePay(tx, { mode: 'period', groupKey, draft: draft as PayRules, today, date: v.date || null, memberId: v.memberId || null });
    },
  });
}
