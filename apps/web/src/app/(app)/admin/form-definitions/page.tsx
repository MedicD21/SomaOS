import Link from 'next/link';
import { Forbidden } from '@/components/forbidden';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { loadAllDefinitions, type FormDef } from '@/server/forms/load';
import { PublishDefinitionForm, RetireForm } from './editor';

const STATUS: Record<string, string> = { draft: 'Draft', published: 'Published', retired: 'Retired' };

export default async function FormDefinitionsPage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('forms')) return <Forbidden reason="forms is not enabled for this department" />;
  const d = check(ctx, 'forms.manage');
  if (!d.allowed) return <Forbidden reason={d.reason} />;
  const defs = await withCtxDb(ctx, (tx) => loadAllDefinitions(tx));
  const byKey = new Map<string, FormDef[]>();
  for (const f of defs) byKey.set(f.key, [...(byKey.get(f.key) ?? []), f]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Form builder</h1>
      <p className="text-muted">
        Forms are never edited in place. Saving creates a new draft version; publishing it retires the old one. Submissions keep the questions they answered.
      </p>
      <p><Link className="underline" href="/admin/form-definitions/new">Create a new form</Link></p>
      <ul aria-label="Forms" className="space-y-3">
        {[...byKey.entries()].map(([key, versions]) => {
          const latest = versions[0]!;
          const published = versions.find((v) => v.status === 'published');
          return (
            <li key={key} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{latest.label}</span>
                <Link className="text-sm underline" href={`/admin/form-definitions/${key}`}>Edit as a new version</Link>
              </div>
              <ul aria-label={`Versions of ${latest.label}`} className="mt-2 space-y-2 text-sm">
                {versions.map((v) => (
                  <li key={v.id} className="space-y-1">
                    <p>Version {v.version}: {STATUS[v.status]} · {v.fields.length} fields{v.requiresSignature ? ' · signed' : ''}{v.approval === 'officer' ? ' · officer approval' : ''}</p>
                    {v.status === 'draft' && <PublishDefinitionForm id={v.id} label={v.label} version={v.version} />}
                  </li>
                ))}
              </ul>
              {published && <div className="mt-2"><RetireForm formKey={key} label={latest.label} /></div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
