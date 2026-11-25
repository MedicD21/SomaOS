import Link from 'next/link';
import { Forbidden } from '@/components/forbidden';
import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { loadCompletions, loadTemplates } from '@/server/inventory/checklists';

export default async function ChecksPage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('inventory')) return <Forbidden reason="assets and inventory are not enabled for this department" />;
  if (!hasAny(ctx, 'inventory.check.perform') && !hasAny(ctx, 'inventory.asset.view')) return <Forbidden reason="no permission to complete checks" />;
  const canPerform = hasAny(ctx, 'inventory.check.perform');
  const data = await withCtxDb(ctx, async (tx) => ({ templates: await loadTemplates(tx), recent: await loadCompletions(tx, { limit: 20 }) }));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Checks</h1>
      <p className="text-muted">Rig checks and station checks. Failed items are recorded on the asset’s history; nothing changes its status automatically.</p>
      <ul aria-label="Checklists" className="space-y-3">
        {data.templates.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4">
            <span><span className="font-semibold">{t.label}</span> <span className="text-sm text-muted">· {t.assetTypeLabel ?? 'Station check'} · {t.items.length} items</span></span>
            {canPerform && <Link className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm underline" href={`/checks/${t.id}`}>Start {t.label}</Link>}
          </li>
        ))}
      </ul>
      <section aria-labelledby="recent">
        <h2 id="recent" className="mb-3 text-lg font-semibold">Recent checks</h2>
        {data.recent.length === 0 ? <p>No checks recorded yet.</p> : (
          <ul aria-label="Recent checks" className="space-y-2">
            {data.recent.map((c) => (
              <li key={c.id} className="rounded-lg border border-line bg-surface p-3 text-sm">
                <span className="font-medium">{c.templateLabel}</span> (v{c.version}) · {c.assetName ?? c.unitName ?? 'Station'} · {c.completedBy} ·{' '}
                {c.failedCount === 0 ? 'All passed' : `${c.failedCount} failed`}
                {c.failedCount > 0 && (
                  <ul className="mt-1 list-disc pl-5">
                    {c.items.filter((i) => c.answers[i.key] === 'fail').map((i) => <li key={i.key}>{i.label}: fail</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
