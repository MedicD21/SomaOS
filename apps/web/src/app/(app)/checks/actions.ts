'use server';
import { answersFromForm, checklistTemplateSchema, completeChecklistSchema } from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { runAdmin, runScoped, zodFieldErrors } from '@/server/actions';
import { getRequestContext, withCtxDb } from '@/server/context';
import { loadTemplate } from '@/server/inventory/checklists';

export async function completeChecklist(templateId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = completeChecklistSchema.safeParse({
    templateId, assetId: form.get('assetId'), orgUnitId: form.get('orgUnitId'), stockLocationId: form.get('stockLocationId'), note: form.get('note') ?? undefined,
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  const ctx = await getRequestContext();
  const template = await withCtxDb(ctx, (tx) => loadTemplate(tx, v.templateId));
  if (!template) return { ok: false, message: 'That checklist was not found.' };
  const answers = answersFromForm(template.items, form);
  return runScoped(['inventory.check.perform'], async (tx) => {
    await tx`select app.complete_checklist(${v.templateId}, ${v.assetId}, ${tx.json(answers as never)}, ${v.note}, ${v.orgUnitId}, ${v.stockLocationId})`;
    return 'Check recorded';
  });
}

/** Saves a checklist; every save is a new version and past completions keep the one they answered. */
export async function saveChecklist(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = checklistTemplateSchema.safeParse({
    label: form.get('label'), key: form.get('key') ?? '', assetTypeId: form.get('assetTypeId'), logFailure: form.get('logFailure') === 'on', items: form.get('items') ?? '',
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('inventory.check.manage', form, async (tx) => {
    await tx`select app.save_checklist_template(${v.key}, ${v.label}, ${v.assetTypeId}, ${tx.json(v.items as never)}, ${v.logFailure})`;
    return `Saved ${v.label} as a new version`;
  });
}
