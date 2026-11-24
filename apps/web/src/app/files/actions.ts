'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/server/actions';
import { ForbiddenError, getRequestContext } from '@/server/context';
import { UploadError, uploadAttachment } from '@/server/files';

const ENTITIES = ['member'] as const;

export async function uploadFile(entity: (typeof ENTITIES)[number], entityId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose a file to upload' };
  if (!ENTITIES.includes(entity) || !z.uuid().safeParse(entityId).success) return { ok: false, message: 'Invalid target' };
  const ctx = await getRequestContext();
  try {
    const a = await uploadAttachment(ctx, { entity, entityId, file });
    revalidatePath('/', 'layout');
    return { ok: true, message: `Uploaded ${a.file_name}` };
  } catch (e) {
    if (e instanceof UploadError) return { ok: false, message: e.message };
    if (e instanceof ForbiddenError) return { ok: false, message: 'You do not have permission to upload files.' };
    throw e;
  }
}
