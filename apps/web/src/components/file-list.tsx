import { Card } from '@/components/ui/card';
import { getRequestContext, hasAny } from '@/server/context';
import { listAttachments } from '@/server/files';
import { FileUpload } from './file-upload';

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export async function FileList({ entity, entityId }: { entity: 'member'; entityId: string }) {
  const ctx = await getRequestContext();
  const canView = hasAny(ctx, 'files.view');
  const canUpload = hasAny(ctx, 'files.upload');
  if (!canView && !canUpload) return null;
  const files = canView ? await listAttachments(ctx, entity, entityId) : [];
  return (
    <Card title="Files">
      {canView && (files.length === 0 ? <p className="mb-4 text-muted">No files yet.</p> : (
        <ul className="mb-4 space-y-1 text-sm">
          {files.map((f) => (
            <li key={f.id}>
              <a className="underline" href={`/files/${f.id}`}>{f.file_name}</a>{' '}
              <span className="text-muted">· {size(Number(f.size_bytes))} · {f.uploaded_at.toLocaleDateString('en-US', { timeZone: ctx.tenant.timezone })}</span>
            </li>
          ))}
        </ul>
      ))}
      {canUpload && <FileUpload entity={entity} entityId={entityId} />}
    </Card>
  );
}
