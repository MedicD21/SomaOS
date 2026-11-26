import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { loadSubmission } from '@/server/forms/load';
import { DecideForms, VoidForm } from '../../forms';

const STATUS: Record<string, string> = {
  submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected', returned: 'Returned for correction', void: 'Void',
};
const stamp = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

function show(value: unknown, options?: { value: string; label: string }[]): string {
  if (value === undefined || value === null || value === '') return '—';
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  const label = (v: unknown) => options?.find((o) => o.value === v)?.label ?? String(v);
  return Array.isArray(value) ? value.map(label).join(', ') : label(value);
}

export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('forms')) return <Forbidden reason="forms is not enabled for this department" />;
  if (!hasAny(ctx, 'forms.submit') && !hasAny(ctx, 'forms.approve') && !hasAny(ctx, 'forms.view_all') && !hasAny(ctx, 'forms.manage')) {
    return <Forbidden reason="no permission to use forms" />;
  }
  const s = await withCtxDb(ctx, (tx) => loadSubmission(tx, id));
  if (!s) notFound();
  const visible = s.snapshot.fields.filter((f) => s.answers[f.key] !== undefined);
  const canVoid = s.status !== 'void' && ((s.mine && s.decisions.length === 0) || hasAny(ctx, 'forms.manage'));
  const canCorrect = s.mine && !s.correctedById && (s.status === 'returned' || s.status === 'rejected') && s.formKey;

  return (
    <div className="space-y-6">
      <p><Link className="underline" href="/forms">← Forms</Link></p>
      <h1 className="text-2xl font-bold">{s.formLabel}</h1>
      <p className="text-muted">
        {s.memberName} · submitted {stamp(s.submittedAt)} · {s.approval === 'officer' ? STATUS[s.status] : 'Filed'} · form version {s.snapshot.version}
      </p>
      {s.correctedById && <p role="note">This submission was corrected by a newer one. <Link className="underline" href={`/forms/submissions/${s.correctedById}`}>See the correction</Link>.</p>}
      {s.correctsId && <p role="note">This is a correction of an earlier submission. <Link className="underline" href={`/forms/submissions/${s.correctsId}`}>See the original</Link>.</p>}

      <Card title="Answers">
        <dl className="space-y-3">
          {visible.map((f) => (
            <div key={f.key}>
              <dt className="text-sm font-medium">{f.label}</dt>
              <dd className="whitespace-pre-wrap">{show(s.answers[f.key], f.options)}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {s.signatures.length > 0 && (
        <Card title="Signatures">
          <ul aria-label="Signatures" className="space-y-4">
            {s.signatures.map((g) => (
              <li key={g.id} className="space-y-1 text-sm">
                <p><span className="font-medium">{g.signerName}</span> signed {stamp(g.signedAt)} ({g.method === 'drawn' ? 'drawn' : `typed “${g.typedName}”`})</p>
                <p className="text-muted">“{g.statement}”</p>
                {g.imagePng && (
                  <img alt={`Drawn signature of ${g.signerName}`} src={`data:image/png;base64,${g.imagePng}`} className="h-24 w-auto max-w-full rounded border border-line bg-white" />
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Record integrity">
        {s.verified ? (
          <p role="status" data-testid="verify-result">
            {s.verified.ok ? 'Intact: the stored answers and signatures match the fingerprint recorded when this was submitted.' : 'Warning: the stored record does not match its recorded fingerprint.'}
          </p>
        ) : <p>Not available.</p>}
        <p className="mt-2 break-all text-xs text-muted">Fingerprint (SHA-256): {s.submissionHash}</p>
      </Card>

      {s.decisions.length > 0 && (
        <Card title="Decisions">
          <ul aria-label="Decisions" className="space-y-2 text-sm">
            {s.decisions.map((d, i) => (
              <li key={i}>{STATUS[d.decision] ?? d.decision} by {d.decidedBy ?? 'a user'} on {stamp(d.decidedAt)}{d.note ? ` — ${d.note}` : ''}</li>
            ))}
          </ul>
        </Card>
      )}

      {s.canDecide && <Card title="Decide"><DecideForms submissionId={s.id} label={s.formLabel} /></Card>}
      {canCorrect && <p><Link className="underline" href={`/forms/${s.formKey}?correct=${s.id}`}>Correct and resubmit</Link></p>}
      {canVoid && <Card title="Void"><VoidForm submissionId={s.id} label={s.formLabel} /></Card>}
    </div>
  );
}
