import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { loadAudienceOptions, loadDocument } from '@/server/documents/load';
import { AssignReadingForm } from '../../sogs/forms';
import { ArchiveForm, PublishForm, UploadVersionForm } from '../forms';

const KIND: Record<string, string> = { document: 'Document', sog: 'SOG', policy: 'Policy' };
const STATUS: Record<string, string> = { draft: 'Draft', published: 'Published', superseded: 'Superseded' };

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('documents')) return <Forbidden reason="documents is not enabled for this department" />;
  if (!hasAny(ctx, 'documents.view') && !hasAny(ctx, 'documents.manage')) return <Forbidden reason="documents.view is required" />;
  const canManage = check(ctx, 'documents.manage').allowed;
  const canPublish = check(ctx, 'documents.publish').allowed;
  const canBackdate = check(ctx, 'documents.backdate').allowed;
  const canAssign = check(ctx, 'sog.assign').allowed;

  const data = await withCtxDb(ctx, async (tx) => ({
    doc: await loadDocument(tx, id),
    audience: canAssign ? await loadAudienceOptions(tx) : { units: [], roles: [] },
  }));
  if (!data.doc) notFound();
  const { doc } = data;
  const published = doc.versions.find((v) => v.status === 'published');

  return (
    <div className="space-y-6">
      <p><Link className="underline" href="/documents">← Documents</Link></p>
      <h1 className="text-2xl font-bold">{doc.title}</h1>
      <p className="text-muted">
        {KIND[doc.kind]}{doc.number ? ` ${doc.number}` : ''} · in {doc.folder}{doc.requiresAck ? ' · members must acknowledge it' : ''}{doc.archived ? ' · archived' : ''}
      </p>

      <section aria-labelledby="versions">
        <h2 id="versions" className="mb-3 text-lg font-semibold">Versions</h2>
        <ul aria-label="Versions" className="space-y-3">
          {doc.versions.map((v) => (
            <li key={v.id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">Version {v.label}</span>
                <span className="text-sm">{STATUS[v.status]}{v.effectiveFrom ? `, effective ${v.effectiveFrom}` : ''}{v.major && v.status !== 'draft' ? ' · major revision' : ''}</span>
              </div>
              {v.changeNote && <p className="text-sm text-muted">{v.changeNote}</p>}
              <p className="text-sm"><a className="underline" href={`/files/${v.attachmentId}`}>{v.fileName}</a></p>
              {v.status === 'draft' && canPublish && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm underline">Publish this version</summary>
                  <div className="mt-2"><PublishForm versionId={v.id} label={v.label} canBackdate={canBackdate} /></div>
                </details>
              )}
              {v.status === 'published' && canAssign && !doc.readings.some((r) => !r.closed && r.versionLabel === v.label) && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm underline">Assign required reading</summary>
                  <div className="mt-2">
                    <AssignReadingForm versionId={v.id} label={v.label}
                      units={data.audience.units.map((u) => ({ id: u.id, label: u.name }))}
                      roles={data.audience.roles.map((r) => ({ id: r.id, label: r.label }))} />
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>

      {doc.readings.length > 0 && (
        <section aria-labelledby="readings">
          <h2 id="readings" className="mb-3 text-lg font-semibold">Required reading</h2>
          <ul aria-label="Readings" className="space-y-2">
            {doc.readings.map((r) => (
              <li key={r.id} className="text-sm">
                Version {r.versionLabel}: {r.acknowledged} of {r.assigned} acknowledged{r.dueOn ? `, due ${r.dueOn}` : ''}{r.closed ? ' (closed)' : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      {canManage && !doc.archived && (
        <>
          <Card title="Upload a new version"><UploadVersionForm documentId={doc.id} /></Card>
          {published === undefined && <p className="text-sm text-muted">Upload a file, then publish it to make it visible to members.</p>}
          <Card title="Archive"><ArchiveForm documentId={doc.id} title={doc.title} /></Card>
        </>
      )}
    </div>
  );
}
