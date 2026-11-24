import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { safeFileName, validateUpload } from '@soma/validators';
import { createSupabaseServer } from '@/lib/supabase/server';
import type { RequestContext } from './context';
import { requirePermission, withCtxDb } from './context';

export const BUCKET = 'tenant-files';

export type Attachment = { id: string; file_name: string; mime_type: string; size_bytes: number; uploaded_at: Date };

export class UploadError extends Error {}

/**
 * Stores a file under <tenant>/<entity>/<entityId>/<uuid>-<name> using the user's own
 * session (storage RLS applies) and records it in `attachments`.
 */
export async function uploadAttachment(
  ctx: RequestContext,
  input: { entity: string; entityId: string; file: File },
): Promise<Attachment> {
  requirePermission(ctx, 'files.upload');
  const problem = validateUpload({ size: input.file.size, type: input.file.type });
  if (problem) throw new UploadError(problem);
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const path = `${ctx.tenant.id}/${input.entity}/${input.entityId}/${randomUUID()}-${safeFileName(input.file.name)}`;

  const supabase = await createSupabaseServer();
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: input.file.type, upsert: false });
  if (error) throw new UploadError(`Upload failed: ${error.message}`);

  const [row] = await withCtxDb(ctx, (tx) => tx<Attachment[]>`
    insert into attachments (tenant_id, entity, entity_id, object_path, file_name, mime_type, size_bytes, sha256)
    values (app.tenant_id(), ${input.entity}, ${input.entityId}, ${path}, ${input.file.name.slice(0, 200)}, ${input.file.type}, ${bytes.length}, ${sha256})
    returning id, file_name, mime_type, size_bytes, uploaded_at`);
  return row!;
}

export async function listAttachments(ctx: RequestContext, entity: string, entityId: string): Promise<Attachment[]> {
  return [...(await withCtxDb(ctx, (tx) => tx<Attachment[]>`
    select id, file_name, mime_type, size_bytes, uploaded_at from attachments
    where entity = ${entity} and entity_id = ${entityId} order by uploaded_at desc`))];
}

/** Short-lived (5 minute) signed URL; null when not found or not permitted. */
export async function getSignedUrl(ctx: RequestContext, attachmentId: string): Promise<string | null> {
  requirePermission(ctx, 'files.view');
  const [row] = await withCtxDb(ctx, (tx) => tx<{ object_path: string; file_name: string }[]>`
    select object_path, file_name from attachments where id = ${attachmentId}`);
  if (!row) return null;
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(row.object_path, 300, { download: row.file_name });
  return error ? null : data.signedUrl;
}
