'use server';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { addVersionSchema, archiveDocumentSchema, createDocumentSchema, folderSchema, publishVersionSchema } from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { friendlyDbError, runAdmin, zodFieldErrors } from '@/server/actions';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { UploadError, uploadAttachment } from '@/server/files';

export async function saveFolder(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = folderSchema.safeParse({
    id: form.get('id') ?? undefined, parentId: form.get('parentId') ?? undefined, name: form.get('name'), viewPermission: form.get('viewPermission') ?? undefined,
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('documents.manage', form, async (tx) => {
    await tx`select app.save_folder(${v.id}, ${v.parentId}, ${v.name}, ${v.viewPermission})`;
    return `Saved folder ${v.name}`;
  });
}

export async function createDocument(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = createDocumentSchema.safeParse({
    folderId: form.get('folderId'), kind: form.get('kind'), title: form.get('title'), number: form.get('number') ?? undefined, requiresAck: form.get('requiresAck'),
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('documents.manage', form, async (tx) => {
    await tx`select app.create_document(${v.folderId}, ${v.kind}, ${v.title}, ${v.number}, ${v.requiresAck})`;
    return `Created ${v.title}`;
  });
}

/** Uploads the file with the existing files module, then records it as a draft version. */
export async function uploadVersion(documentId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose a file to upload', fieldErrors: { file: 'Choose a file to upload' } };
  const parsed = addVersionSchema.safeParse({ documentId, label: form.get('label'), changeNote: form.get('changeNote') ?? undefined });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  const ctx = await getRequestContext();
  const d = check(ctx, 'documents.manage');
  if (!d.allowed) return { ok: false, message: `Not allowed: ${d.reason}` };
  try {
    const att = await uploadAttachment(ctx, { entity: 'document_version', entityId: randomUUID(), file });
    await withCtxDb(ctx, (tx) => tx`select app.add_document_version(${v.documentId}, ${att.id}, ${v.label}, ${v.changeNote})`);
    revalidatePath('/', 'layout');
    return { ok: true, message: `Added draft version ${v.label}. Publish it when it is ready.` };
  } catch (e) {
    if (e instanceof UploadError) return { ok: false, message: e.message };
    return { ok: false, message: friendlyDbError(e) };
  }
}

export async function publishVersion(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = publishVersionSchema.safeParse({
    versionId: form.get('versionId'), effectiveFrom: form.get('effectiveFrom') ?? undefined, major: form.get('major'), backdateReason: form.get('backdateReason') ?? undefined,
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('documents.publish', form, async (tx) => {
    await tx`select app.publish_document_version(${v.versionId}, ${v.effectiveFrom}::date, ${v.major}, ${v.backdateReason})`;
    return 'Published. The previous version is now superseded.';
  });
}

export async function archiveDocument(documentId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = archiveDocumentSchema.safeParse({ documentId, reason: form.get('reason') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('documents.manage', form, async (tx) => {
    await tx`select app.archive_document(${v.documentId}, ${v.reason})`;
    return 'Archived. Every version is kept.';
  });
}
