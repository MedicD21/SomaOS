import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { loadPublishedForm, loadSubmission } from '@/server/forms/load';
import { FillForm } from '../forms';

/** Fill in a published form; `?correct=<submission id>` opens it with the earlier answers to correct a returned submission. */
export default async function FillFormPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ correct?: string }> }) {
  const { key } = await params;
  const { correct } = await searchParams;
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) notFound();
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('forms')) return <Forbidden reason="forms is not enabled for this department" />;
  if (!hasAny(ctx, 'forms.submit')) return <Forbidden reason="forms.submit is required" />;

  const data = await withCtxDb(ctx, async (tx) => ({
    def: await loadPublishedForm(tx, key),
    original: correct && /^[0-9a-f-]{36}$/.test(correct) ? await loadSubmission(tx, correct) : null,
  }));
  if (!data.def) notFound();
  const { def, original } = data;
  const correcting = original && original.mine && original.formKey === def.key ? original : null;

  return (
    <div className="space-y-6">
      <p><Link className="underline" href="/forms">← Forms</Link></p>
      <h1 className="text-2xl font-bold">{def.label}</h1>
      {def.description && <p className="text-muted">{def.description}</p>}
      {correcting?.decisions.some((d) => d.decision === 'returned') && (
        <Card title="Returned for correction">
          <p>{correcting.decisions.find((d) => d.decision === 'returned')?.note}</p>
        </Card>
      )}
      <Card>
        <FillForm
          definitionId={def.id} label={def.label} fields={def.fields} requiresSignature={def.requiresSignature}
          statement={def.signatureStatement} correctsId={correcting?.id} answers={correcting?.answers}
        />
      </Card>
    </div>
  );
}
