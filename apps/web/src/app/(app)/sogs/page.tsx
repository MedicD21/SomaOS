import Link from 'next/link';
import { Forbidden } from '@/components/forbidden';
import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { loadLibrary } from '@/server/documents/load';
import { loadMyReadings, loadReadingReport } from '@/server/documents/readings';
import { AcknowledgeForm } from './forms';

const when = (d: Date) => d.toISOString().slice(0, 10);

export default async function SogsPage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('documents')) return <Forbidden reason="documents is not enabled for this department" />;
  const canRead = hasAny(ctx, 'sog.acknowledge');
  const canReport = hasAny(ctx, 'sog.report') || hasAny(ctx, 'sog.assign');
  if (!canRead && !canReport) return <Forbidden reason="no permission to see required reading" />;

  const data = await withCtxDb(ctx, async (tx) => ({
    mine: canRead ? await loadMyReadings(tx) : [],
    report: canReport ? await loadReadingReport(tx) : [],
    library: await loadLibrary(tx),
  }));
  const todo = data.mine.filter((r) => !r.acknowledgedAt && !r.closed);
  const done = data.mine.filter((r) => r.acknowledgedAt);
  const sogs = data.library.docs.filter((d) => (d.kind === 'sog' || d.kind === 'policy') && d.versionId);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">SOGs and required reading</h1>

      {canRead && (
        <section aria-labelledby="todo">
          <h2 id="todo" className="mb-3 text-lg font-semibold">My required reading</h2>
          {todo.length === 0 ? <p>You are all caught up.</p> : (
            <ul aria-label="Required reading to do" className="space-y-3">
              {todo.map((r) => (
                <li key={r.readingId} className="rounded-lg border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{r.title}{r.number ? ` (${r.number})` : ''}</span>
                    <span className={`text-sm ${r.overdue ? 'font-semibold text-danger' : ''}`}>
                      {r.overdue ? 'Overdue — ' : ''}{r.dueOn ? `due ${r.dueOn}` : 'no due date'}
                    </span>
                  </div>
                  <p className="text-sm text-muted">Version {r.versionLabel}</p>
                  {r.attachmentId && <p className="my-2 text-sm"><a className="underline" href={`/files/${r.attachmentId}`}>Open the document</a></p>}
                  <AcknowledgeForm readingId={r.readingId} title={r.title} statement={r.statement} requireTypedName={r.requireTypedName} />
                </li>
              ))}
            </ul>
          )}
          {done.length > 0 && (
            <>
              <h3 className="mb-2 mt-5 font-semibold">Already acknowledged</h3>
              <ul aria-label="Acknowledged reading" className="space-y-1 text-sm">
                {done.map((r) => <li key={r.readingId}>{r.title}, version {r.versionLabel}, on {when(r.acknowledgedAt!)}</li>)}
              </ul>
            </>
          )}
        </section>
      )}

      <section aria-labelledby="library">
        <h2 id="library" className="mb-3 text-lg font-semibold">SOG and policy library</h2>
        {sogs.length === 0 ? <p>Nothing has been published yet.</p> : (
          <ul aria-label="Published SOGs and policies" className="space-y-1 text-sm">
            {sogs.map((d) => (
              <li key={d.id}>
                <Link className="underline" href={`/documents/${d.id}`}>{d.number ? `${d.number} ` : ''}{d.title}</Link>
                <span className="text-muted"> — version {d.label}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canReport && (
        <section aria-labelledby="report">
          <h2 id="report" className="mb-3 text-lg font-semibold">Who has read what</h2>
          {data.report.length === 0 ? <p>No required reading is open.</p> : (
            <ul aria-label="Reading status" className="space-y-3">
              {data.report.map((r) => (
                <li key={r.readingId} className="rounded-lg border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{r.title} <span className="font-normal text-muted">version {r.versionLabel}</span></span>
                    <span className="text-sm">{r.acknowledged} of {r.assigned} acknowledged{r.dueOn ? `, due ${r.dueOn}` : ''}{r.overdue > 0 ? ` · ${r.overdue} overdue` : ''}</span>
                  </div>
                  {r.waiting.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm underline">Not yet acknowledged ({r.waiting.length})</summary>
                      <ul className="mt-2 list-disc pl-5 text-sm">{r.waiting.map((n) => <li key={n}>{n}</li>)}</ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
