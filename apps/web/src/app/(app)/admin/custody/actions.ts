'use server';
import { csItemSchema, csLocationSchema, csLotSchema, csRecallSchema } from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { runScoped, zodFieldErrors } from '@/server/actions';

const MAN = ['custody.manage'] as const;
const f = (form: FormData, k: string) => form.get(k) ?? undefined;

export async function addCsItem(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = csItemSchema.safeParse({ name: form.get('name'), schedule: form.get('schedule'), ndc: f(form, 'ndc'), unit: form.get('unit'), note: f(form, 'note') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped([...MAN], async (tx) => {
    await tx`select app.create_cs_item(${v.name}, ${v.schedule}, ${v.ndc}::text, ${v.unit}, ${v.note}::text)`;
    return `Added ${v.name}`;
  });
}

export async function addCsLot(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = csLotSchema.safeParse({ itemId: form.get('itemId'), lotNo: form.get('lotNo'), expiresOn: form.get('expiresOn') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped([...MAN], async (tx) => {
    await tx`select app.create_cs_lot(${v.itemId}::uuid, ${v.lotNo}, ${v.expiresOn}::date)`;
    return `Added lot ${v.lotNo}`;
  });
}

export async function addCsLocation(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = csLocationSchema.safeParse({ name: form.get('name'), kind: form.get('kind'), orgUnitId: form.get('orgUnitId'), memberId: f(form, 'memberId') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped([...MAN], async (tx) => {
    await tx`select app.create_cs_location(${v.name}, ${v.kind}, ${v.orgUnitId}::uuid, ${v.memberId}::uuid, ${null}::uuid)`;
    return `Added ${v.name}`;
  });
}

export async function recallCsLot(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = csRecallSchema.safeParse({ lotId: form.get('lotId'), note: form.get('note') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped([...MAN], async (tx) => {
    await tx`select app.flag_cs_lot_recall(${v.lotId}::uuid, ${v.note})`;
    return 'Lot flagged as recalled. It can no longer be received, moved or administered.';
  });
}

export async function archiveCsLocation(id: string): Promise<ActionResult> {
  return runScoped([...MAN], async (tx) => {
    await tx`select app.archive_cs_location(${id}::uuid)`;
    return 'Archived';
  });
}

export async function archiveCsLot(id: string): Promise<ActionResult> {
  return runScoped([...MAN], async (tx) => {
    await tx`select app.archive_cs_lot(${id}::uuid)`;
    return 'Archived';
  });
}
