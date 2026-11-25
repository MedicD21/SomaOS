'use server';
import { trainingArchiveSchema, trainingCategorySchema, trainingCourseSchema, trainingRequirementSchema } from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { runAdmin, zodFieldErrors } from '@/server/actions';

export async function addCategory(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = trainingCategorySchema.safeParse({ label: form.get('label'), key: form.get('key') ?? '', externalCode: form.get('externalCode') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('training.course.manage', form, async (tx) => {
    await tx`select app.save_training_category(null, ${v.key}, ${v.label}, ${v.externalCode})`;
    return `Added ${v.label}`;
  });
}

export async function addCourse(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = trainingCourseSchema.safeParse({
    label: form.get('label'), key: form.get('key') ?? '', categoryId: form.get('categoryId'), defaultHours: form.get('defaultHours'),
    credentialTypeId: form.get('credentialTypeId'), minHoursPct: form.get('minHoursPct') ?? undefined, description: form.get('description'),
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('training.course.manage', form, async (tx) => {
    await tx`select app.save_training_course(null, ${v.key}, ${v.label}, ${v.categoryId}, ${v.defaultHours}, ${v.credentialTypeId}, ${v.minHoursPct}, ${v.description})`;
    return `Added ${v.label}`;
  });
}

export async function addRequirement(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = trainingRequirementSchema.safeParse({
    label: form.get('label'), categoryId: form.get('categoryId'), rankId: form.get('rankId'), roleId: form.get('roleId'),
    requiredHours: form.get('requiredHours'), windowKind: form.get('windowKind'), months: form.get('months'), month: form.get('month'),
    day: form.get('day'), years: form.get('years'), effectiveFrom: form.get('effectiveFrom'),
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('training.course.manage', form, async (tx) => {
    await tx`select app.save_training_requirement(${v.label}, ${v.categoryId}, ${v.rankId}, ${v.roleId}, ${v.requiredHours}, ${tx.json(v.window as never)}, ${v.effectiveFrom}::date)`;
    return `Added ${v.label} from ${v.effectiveFrom}. A requirement for the same category, rank and role that was open-ended now ends the day before.`;
  });
}

type Kind = 'category' | 'course' | 'requirement';

export async function archiveItem(kind: Kind, id: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = trainingArchiveSchema.safeParse({ id, reason: form.get('reason') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('training.course.manage', form, async (tx) => {
    if (kind === 'category') await tx`select app.archive_training_category(${v.id}, ${v.reason})`;
    else if (kind === 'course') await tx`select app.archive_training_course(${v.id}, ${v.reason})`;
    else await tx`select app.archive_training_requirement(${v.id}, ${v.reason})`;
    return 'Archived.';
  });
}
