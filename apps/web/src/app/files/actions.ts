'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/server/actions';
import { ForbiddenError, getRequestContext, requirePermission, withCtxDb } from '@/server/context';
import { UploadError, uploadAttachment } from '@/server/files';

const ENTITIES = ['member', 'member_credential'] as const;
export type AttachmentEntity = (typeof ENTITIES)[number];

export async function uploadFile(entity: AttachmentEntity, entityId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose a file to upload' };
  if (!ENTITIES.includes(entity) || !z.uuid().safeParse(entityId).success) return { ok: false, message: 'Invalid target' };
  const ctx = await getRequestContext();
  try {
    let sensitivity: 'HR' | null = null;
    if (entity === 'member_credential') {
      // Credential documents are HR records: only credential managers attach them, to a credential in this department.
      requirePermission(ctx, 'credentials.manage');
      const [cred] = await withCtxDb(ctx, (tx) => tx`select 1 from member_credentials where id = ${entityId} and tenant_id = app.tenant_id()`);
      if (!cred) return { ok: false, message: 'Invalid target' };
      sensitivity = 'HR';
    }
    const a = await uploadAttachment(ctx, { entity, entityId, file, sensitivity });
    revalidatePath('/', 'layout');
    return { ok: true, message: `Uploaded ${a.file_name}` };
  } catch (e) {
    if (e instanceof UploadError) return { ok: false, message: e.message };
    if (e instanceof ForbiddenError) return { ok: false, message: 'You do not have permission to upload files.' };
    throw e;
  }
}
