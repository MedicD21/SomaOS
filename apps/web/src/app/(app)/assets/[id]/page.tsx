import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { loadFieldDefs } from '@/server/custom-fields';
import { loadAsset, loadUnits, STATUS_LABEL } from '@/server/inventory/assets';
import { loadCompletions } from '@/server/inventory/checklists';
import { ArchiveAssetForm, MoveForm, NoteForm, StatusForm } from '../forms';

const KIND: Record<string, string> = { check: 'Check', maintenance: 'Maintenance', status_change: 'Status', assignment: 'Moved', note: 'Note' };

function describe(e: { kind: string; fromStatus: string | null; toStatus: string | null; fromUnit: string | null; toUnit: string | null; note: string | null }): string {
  if (e.kind === 'status_change') return `${STATUS_LABEL[e.fromStatus ?? ''] ?? e.fromStatus} → ${STATUS_LABEL[e.toStatus ?? ''] ?? e.toStatus}${e.note ? ` — ${e.note}` : ''}`;
  if (e.kind === 'assignment') return `${e.fromUnit ?? 'No station'} → ${e.toUnit ?? 'No station'}${e.note ? ` — ${e.note}` : ''}`;
  return e.note ?? '';
}

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('inventory')) return <Forbidden reason="assets and inventory are not enabled for this department" />;
  if (!hasAny(ctx, 'inventory.asset.view')) return <Forbidden reason="inventory.asset.view is required" />;

  const data = await withCtxDb(ctx, async (tx) => {
    const found = await loadAsset(tx, id);
    if (!found) return null;
    return { ...found, units: await loadUnits(tx), defs: await loadFieldDefs(tx, 'asset', true), checks: await loadCompletions(tx, { assetId: id, limit: 10 }) };
  });
  if (!data) notFound();
  const { asset, events, units, defs, checks } = data;
  const canEvent = hasAny(ctx, 'inventory.asset.event') && !asset.archived;
  const canManage = hasAny(ctx, 'inventory.asset.manage');

  return (
    <div className="space-y-6">
      <p><Link className="underline" href="/assets">← All assets</Link></p>
      <h1 className="text-2xl font-bold">{asset.name}</h1>
      <p>
        <span className="font-semibold">{STATUS_LABEL[asset.status] ?? asset.status}</span> · {asset.typeLabel}
        {asset.identifier ? ` · ${asset.identifier}` : ''} · {asset.unitName ?? 'No station'}{asset.archived ? ' · Archived' : ''}
      </p>
      {defs.some((d) => asset.custom[d.key] !== undefined) && (
        <dl className="grid gap-2 sm:grid-cols-2">
          {defs.filter((d) => asset.custom[d.key] !== undefined && asset.custom[d.key] !== '').map((d) => (
            <div key={d.key}><dt className="text-sm text-muted">{d.label}</dt><dd>{String(asset.custom[d.key])}</dd></div>
          ))}
        </dl>
      )}

      {canEvent && asset.status !== 'retired' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Change status"><StatusForm assetId={asset.id} current={asset.status} /></Card>
          <Card title="Move to another station"><MoveForm assetId={asset.id} units={units} /></Card>
        </div>
      )}
      {canEvent && <Card title="Add a note"><NoteForm assetId={asset.id} /></Card>}
      {canManage && asset.status === 'retired' && !asset.archived && <Card title="Archive this asset"><ArchiveAssetForm assetId={asset.id} /></Card>}

      <section aria-labelledby="history">
        <h2 id="history" className="mb-3 text-lg font-semibold">History</h2>
        <ul aria-label="Asset history" className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="rounded-lg border border-line bg-surface p-3 text-sm">
              <span className="font-medium">{KIND[e.kind] ?? e.kind}</span> · {e.occurredAt.toISOString().slice(0, 16).replace('T', ' ')} UTC{e.by ? ` · ${e.by}` : ''}
              <span className="block">{describe(e)}</span>
            </li>
          ))}
        </ul>
      </section>

      {checks.length > 0 && (
        <section aria-labelledby="checks">
          <h2 id="checks" className="mb-3 text-lg font-semibold">Recent checks</h2>
          <ul aria-label="Recent checks" className="space-y-2">
            {checks.map((c) => (
              <li key={c.id} className="rounded-lg border border-line bg-surface p-3 text-sm">
                {c.templateLabel} (v{c.version}) · {c.completedBy} · {c.failedCount === 0 ? 'All passed' : `${c.failedCount} failed`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
