import Link from 'next/link';
import { Forbidden } from '@/components/forbidden';
import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { loadPublishedForms, loadSubmissions, type SubmissionRow } from '@/server/forms/load';

const STATUS: Record<string, string> = {
  submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected', returned: 'Returned for correction', void: 'Void',
};
const stamp = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

function Row({ s, who }: { s: SubmissionRow; who: boolean }) {
  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link className="font-semibold underline" href={`/forms/submissions/${s.id}`}>{s.formLabel}</Link>
        <span className="text-sm">{s.correctedById ? 'Corrected by a newer submission' : s.approval === 'officer' ? STATUS[s.status] : 'Filed'}</span>
      </div>
      <p className="text-sm text-muted">{who ? `${s.memberName} · ` : ''}{stamp(s.submittedAt)} UTC{s.correctsId ? ' · correction' : ''}</p>
    </li>
  );
}

export default async function FormsPage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('forms')) return <Forbidden reason="forms is not enabled for this department" />;
  const canSubmit = hasAny(ctx, 'forms.submit');
  const canApprove = hasAny(ctx, 'forms.approve');
  if (!canSubmit && !canApprove && !hasAny(ctx, 'forms.manage') && !hasAny(ctx, 'forms.view_all')) return <Forbidden reason="no permission to use forms" />;

  const data = await withCtxDb(ctx, async (tx) => ({
    forms: canSubmit ? await loadPublishedForms(tx) : [],
    mine: canSubmit ? await loadSubmissions(tx, 'mine') : [],
    pending: canApprove ? await loadSubmissions(tx, 'pending') : [],
  }));

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Forms</h1>

      {canSubmit && (
        <section aria-labelledby="available">
          <h2 id="available" className="mb-3 text-lg font-semibold">Fill in a form</h2>
          {data.forms.length === 0 ? <p>No forms are published yet.</p> : (
            <ul aria-label="Available forms" className="space-y-3">
              {data.forms.map((f) => (
                <li key={f.id} className="rounded-lg border border-line bg-surface p-4">
                  <Link className="font-semibold underline" href={`/forms/${f.key}`}>{f.label}</Link>
                  {f.description && <p className="text-sm text-muted">{f.description}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {canApprove && (
        <section aria-labelledby="pending">
          <h2 id="pending" className="mb-3 text-lg font-semibold">Waiting for your approval</h2>
          {data.pending.length === 0 ? <p>Nothing is waiting for you.</p> : (
            <ul aria-label="Waiting for approval" className="space-y-3">{data.pending.map((s) => <Row key={s.id} s={s} who />)}</ul>
          )}
        </section>
      )}

      {canSubmit && (
        <section aria-labelledby="mine">
          <h2 id="mine" className="mb-3 text-lg font-semibold">My submissions</h2>
          {data.mine.length === 0 ? <p>You have not submitted anything yet.</p> : (
            <ul aria-label="My submissions" className="space-y-3">{data.mine.map((s) => <Row key={s.id} s={s} who={false} />)}</ul>
          )}
        </section>
      )}
    </div>
  );
}
