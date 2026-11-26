import Link from 'next/link';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { loadLibrary, type Folder, type LibraryDoc } from '@/server/documents/load';
import { DocumentForm, FolderForm } from './forms';

const KIND: Record<string, string> = { document: 'Document', sog: 'SOG', policy: 'Policy' };

function FolderNode({ folder, folders, docs, depth }: { folder: Folder; folders: Folder[]; docs: LibraryDoc[]; depth: number }) {
  const children = folders.filter((f) => f.parentId === folder.id);
  const mine = docs.filter((d) => d.folderId === folder.id);
  return (
    <li className="rounded-lg border border-line bg-surface p-4" style={{ marginLeft: depth ? 16 : 0 }}>
      <h3 className="font-semibold">
        {folder.name}
        {folder.viewPermission && <span className="ml-2 rounded border border-line px-2 py-0.5 text-xs font-normal">Restricted</span>}
      </h3>
      {mine.length === 0 && children.length === 0 && <p className="text-sm text-muted">Empty</p>}
      {mine.length > 0 && (
        <ul className="mt-2 space-y-2">
          {mine.map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span>
                <Link className="font-medium underline" href={`/documents/${d.id}`}>{d.title}</Link>
                <span className="ml-2 text-muted">{KIND[d.kind]}{d.number ? ` ${d.number}` : ''}</span>
              </span>
              <span className="text-muted">
                {d.label ? `Version ${d.label}${d.effectiveFrom ? `, effective ${d.effectiveFrom}` : ''}` : 'No published version yet'}
                {d.attachmentId && <> · <a className="underline" href={`/files/${d.attachmentId}`}>Open file</a></>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {children.length > 0 && (
        <ul className="mt-3 space-y-3" aria-label={`Folders in ${folder.name}`}>
          {children.map((c) => <FolderNode key={c.id} folder={c} folders={folders} docs={docs} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}

export default async function DocumentsPage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('documents')) return <Forbidden reason="documents is not enabled for this department" />;
  if (!hasAny(ctx, 'documents.view') && !hasAny(ctx, 'documents.manage')) return <Forbidden reason="documents.view is required" />;
  const canManage = check(ctx, 'documents.manage').allowed;
  const { folders, docs } = await withCtxDb(ctx, (tx) => loadLibrary(tx));
  const roots = folders.filter((f) => f.parentId === null);
  const options = (() => {
    const out: { id: string; label: string }[] = [];
    const walk = (parent: string | null, prefix: string) => {
      for (const f of folders.filter((x) => x.parentId === parent)) {
        out.push({ id: f.id, label: `${prefix}${f.name}` });
        walk(f.id, `${prefix}${f.name} / `);
      }
    };
    walk(null, '');
    return out;
  })();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Documents</h1>
      <p className="text-muted">The department’s library: policies, SOGs and reference documents. Each document keeps every version it has had.</p>
      {roots.length === 0 ? <p>No folders yet.</p> : (
        <ul aria-label="Folders" className="space-y-3">
          {roots.map((f) => <FolderNode key={f.id} folder={f} folders={folders} docs={docs} depth={0} />)}
        </ul>
      )}
      {canManage && (
        <>
          <Card title="New document"><DocumentForm folders={options} /></Card>
          <Card title="New folder"><FolderForm folders={options} /></Card>
        </>
      )}
    </div>
  );
}
