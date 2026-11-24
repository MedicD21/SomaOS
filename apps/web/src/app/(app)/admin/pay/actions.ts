'use server';
import { employeeGroupSchema, parsePayRulesJson, payCodeSchema, payRateSchema } from '@soma/validators';
import { z } from 'zod';
import type { ActionResult } from '@/server/actions';
import { ActionError, runAdmin, zodFieldErrors } from '@/server/actions';
import { check, getRequestContext } from '@/server/context';
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
  const parsed = parsePayRulesJson(String(form.get('rules') ?? ''));
  if (!parsed.ok) return { ok: false, message: parsed.error, fieldErrors: { rules: parsed.error } };
  return runAdmin('pay.manage', form, async (tx) => `Saved draft v${await saveRulesDraft(tx, groupKey, parsed.rules)}`);
}

export async function approveRules(groupKey: string, version: number, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const effectiveDate = String(form.get('effectiveFrom') ?? '');
  if (!KEY.test(groupKey) || !Number.isInteger(version)) return { ok: false, message: 'Unknown pay rules.' };
  if (!ISO.test(effectiveDate)) return { ok: false, message: 'Enter the date these rules take effect.', fieldErrors: { effectiveFrom: 'Required' } };
  // Approving changes what people are paid: it needs pay and configuration authority.
  const ctx = await getRequestContext();
  const d = check(ctx, 'pay.manage');
  if (!d.allowed) return { ok: false, message: `Not allowed: ${d.reason}` };
  return runAdmin('admin.config.manage', form, async (tx) => {
    await approveRulesDraft(tx, groupKey, version, effectiveDate);
    return `Approved v${version} from ${effectiveDate}`;
  });
}
