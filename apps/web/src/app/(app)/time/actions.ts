'use server';
import { timeEntrySchema, voidTimeEntrySchema } from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { runScoped, zodFieldErrors } from '@/server/actions';

const WHO = ['scheduling.roster.edit', 'pay.manage'] as const;

/** Records time for a member. The database checks the caller covers that member's station and shift. */
export async function addTimeEntry(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = timeEntrySchema.safeParse({
    memberId: form.get('memberId'), workDate: form.get('workDate'), hours: form.get('hours'), type: form.get('type'), reason: form.get('reason'),
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped([...WHO], async (tx) => {
    await tx`select app.add_time_entry(${v.memberId}, ${v.workDate}::date, ${v.hours}, ${v.type}, ${v.reason})`;
    return `Recorded ${v.hours} h on ${v.workDate}`;
  });
}

export async function voidTimeEntry(id: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = voidTimeEntrySchema.safeParse({ id, reason: form.get('reason') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped([...WHO], async (tx) => {
    await tx`select app.void_time_entry(${v.id}, ${v.reason})`;
    return 'Entry voided';
  });
}
