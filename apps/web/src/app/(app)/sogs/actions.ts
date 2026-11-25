'use server';
import { acknowledgeSchema, assignReadingSchema } from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { runAdmin, runScoped, zodFieldErrors } from '@/server/actions';

export async function assignReading(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = assignReadingSchema.safeParse({
    versionId: form.get('versionId'),
    everyone: form.get('everyone'),
    orgUnitIds: form.getAll('orgUnitIds').map(String),
    roleIds: form.getAll('roleIds').map(String),
    dueOn: form.get('dueOn') ?? undefined,
    statement: form.get('statement') ?? undefined,
    requireTypedName: form.get('requireTypedName'),
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('sog.assign', form, async (tx) => {
    await tx`select app.assign_reading(${v.versionId}, ${tx.json(v.audience as never)}, ${v.dueOn}::date, ${v.statement}, ${v.requireTypedName})`;
    return 'Assigned. Members have been notified.';
  });
}

export async function acknowledge(readingId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = acknowledgeSchema.safeParse({ readingId, typedName: form.get('typedName') ?? undefined });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped(['sog.acknowledge'], async (tx) => {
    await tx`select app.acknowledge_reading(${v.readingId}, ${v.typedName})`;
    return 'Acknowledged. Thank you.';
  });
}
