'use server';
import { headers } from 'next/headers';
import { coerceAnswers, decideFormSchema, submitFormSchema, voidFormSchema } from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { ActionError, runScoped, zodFieldErrors } from '@/server/actions';
import type { FormDef } from '@/server/forms/load';

/**
 * Submits a form. The answers are typed from the posted values using the published definition, then the database validates
 * every rule again and computes the hashes; the signature, IP and browser are recorded with the submission.
 */
export async function submitForm(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = submitFormSchema.safeParse({
    definitionId: form.get('definitionId'),
    correctsId: form.get('correctsId') ?? undefined,
    signatureMethod: form.get('signatureMethod') ?? undefined,
    typedName: form.get('typedName') ?? undefined,
    signatureImage: form.get('signatureImage') ?? undefined,
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? '';
  const ua = h.get('user-agent') ?? '';
  return runScoped(['forms.submit'], async (tx) => {
    const [def] = await tx<Pick<FormDef, 'fields' | 'requiresSignature'>[]>`select fields, requires_signature as "requiresSignature" from form_definitions where id = ${v.definitionId}`;
    if (!def) throw new ActionError('That form is not available.');
    const raw: Record<string, string | string[]> = {};
    for (const f of def.fields) raw[f.key] = f.type === 'multi_select' ? form.getAll(f.key).map(String) : String(form.get(f.key) ?? '');
    const answers = coerceAnswers(def.fields, raw);
    let signature: Record<string, string> | null = null;
    if (v.signatureMethod === 'typed') signature = { method: 'typed', typed_name: v.typedName ?? '' };
    if (v.signatureMethod === 'drawn') signature = { method: 'drawn', image_png: v.signatureImage ?? '' };
    await tx`select app.submit_form(${v.definitionId}, ${tx.json(answers as never)}, ${signature ? tx.json(signature as never) : null}, ${v.correctsId}, ${ip}, ${ua})`;
    return 'Submitted.';
  });
}

export async function decide(submissionId: string, decision: 'approved' | 'rejected' | 'returned', _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = decideFormSchema.safeParse({ submissionId, decision, note: form.get('note') ?? undefined });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped(['forms.approve'], async (tx) => {
    await tx`select app.decide_form(${v.submissionId}, ${v.decision}, ${v.note})`;
    return v.decision === 'approved' ? 'Approved.' : v.decision === 'returned' ? 'Returned to the submitter for correction.' : 'Rejected.';
  });
}

export async function voidSubmission(submissionId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = voidFormSchema.safeParse({ submissionId, reason: form.get('reason') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped(['forms.submit', 'forms.manage'], async (tx) => {
    await tx`select app.void_form(${v.submissionId}, ${v.reason})`;
    return 'Voided. The record is kept.';
  });
}
