import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Forbidden } from '@/components/forbidden';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { loadAllDefinitions } from '@/server/forms/load';
import { DefinitionEditor } from '../editor';

/** `new` starts a blank form; any other key opens its latest version as the starting point for a new draft. */
export default async function EditDefinitionPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (key !== 'new' && !/^[a-z][a-z0-9_]{0,39}$/.test(key)) notFound();
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('forms')) return <Forbidden reason="forms is not enabled for this department" />;
  const d = check(ctx, 'forms.manage');
  if (!d.allowed) return <Forbidden reason={d.reason} />;
  const latest = key === 'new' ? null : (await withCtxDb(ctx, (tx) => loadAllDefinitions(tx))).find((f) => f.key === key) ?? null;
  if (key !== 'new' && !latest) notFound();

  return (
    <div className="space-y-6">
      <p><Link className="underline" href="/admin/form-definitions">← Form builder</Link></p>
      <h1 className="text-2xl font-bold">{latest ? `Edit ${latest.label}` : 'New form'}</h1>
      <DefinitionEditor
        initial={{
          key: latest?.key ?? '', label: latest?.label ?? '', description: latest?.description ?? '', fields: latest?.fields ?? [],
          requiresSignature: latest?.requiresSignature ?? false, signatureStatement: latest?.signatureStatement ?? '',
          approval: latest?.approval ?? 'none', isNew: !latest,
        }}
      />
    </div>
  );
}
