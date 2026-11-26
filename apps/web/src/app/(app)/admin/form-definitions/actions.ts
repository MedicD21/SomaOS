'use server';
import { formDefinitionSchema } from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { runAdmin, zodFieldErrors } from '@/server/actions';

/** Saves a new draft version of a form (a form is never edited in place). */
export async function saveDefinition(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  let fields: unknown;
  try {
    fields = JSON.parse(String(form.get('fields') ?? '[]'));
  } catch {
    return { ok: false, message: 'The field list could not be read. Reload the page and try again.' };
  }
  const parsed = formDefinitionSchema.safeParse({
    key: form.get('key'),
    label: form.get('label'),
    description: form.get('description') ?? undefined,
    fields,
    requiresSignature: form.get('requiresSignature'),
    signatureStatement: form.get('signatureStatement') ?? undefined,
    approval: form.get('approval'),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const res = zodFieldErrors(parsed.error.issues);
    return issue?.path[0] === 'fields' ? { ...res, message: `${issue.message}` } : res;
  }
  const v = parsed.data;
  return runAdmin('forms.manage', form, async (tx) => {
    const [saved] = await tx<{ id: string }[]>`
      select app.save_form_definition(${v.key}, ${v.label}, ${v.description}, ${tx.json(v.fields as never)}, ${v.requiresSignature}, ${v.signatureStatement}, ${v.approval}) as id`;
    const [row] = await tx<{ version: number }[]>`select version from form_definitions where id = ${saved!.id}`;
    return `Saved draft version ${row!.version} of ${v.label}. Publish it to make it available.`;
  });
}

export async function publishDefinition(id: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  return runAdmin('forms.manage', form, async (tx) => {
    await tx`select app.publish_form_definition(${id})`;
    return 'Published. The previous version is retired; earlier submissions keep the questions they answered.';
  });
}

export async function retireForm(key: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  return runAdmin('forms.manage', form, async (tx) => {
    await tx`select app.retire_form(${key})`;
    return 'Retired. Members can no longer fill it in; submissions are kept.';
  });
}
