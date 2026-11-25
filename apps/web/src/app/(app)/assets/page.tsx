import Link from 'next/link';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { loadFieldDefs } from '@/server/custom-fields';
import { loadAssets, loadAssetTypes, loadUnits, STATUS_LABEL } from '@/server/inventory/assets';
import { AddAssetForm } from './forms';

const FILTERS = ['in_service', 'out_of_service', 'reserve', 'maintenance', 'retired'] as const;

export default async function AssetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('inventory')) return <Forbidden reason="assets and inventory are not enabled for this department" />;
  if (!hasAny(ctx, 'inventory.asset.view')) return <Forbidden reason="inventory.asset.view is required" />;
  const status = FILTERS.find((f) => f === sp.status);
  const canManage = hasAny(ctx, 'inventory.asset.manage');

  const data = await withCtxDb(ctx, async (tx) => ({
    assets: await loadAssets(tx, { status }),
    types: canManage ? await loadAssetTypes(tx) : [],
    units: canManage ? await loadUnits(tx) : [],
    defs: canManage ? await loadFieldDefs(tx, 'asset') : [],
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Assets</h1>
      <nav aria-label="Filter by status" className="flex flex-wrap gap-3 text-sm">
        <Link className={status ? 'underline' : 'font-semibold underline'} href="/assets">All</Link>
        {FILTERS.map((f) => (
          <Link key={f} className={status === f ? 'font-semibold underline' : 'underline'} href={`/assets?status=${f}`}>{STATUS_LABEL[f]}</Link>
        ))}
      </nav>
      {data.assets.length === 0 ? (
        <p>No assets{status ? ` with status “${STATUS_LABEL[status]}”` : ' yet'}.</p>
      ) : (
        <ul aria-label="Assets" className="space-y-3">
          {data.assets.map((a) => (
            <li key={a.id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link className="font-semibold underline" href={`/assets/${a.id}`}>{a.name}</Link>
                <span className="text-sm font-medium">{STATUS_LABEL[a.status] ?? a.status}</span>
              </div>
              <p className="text-sm text-muted">{a.typeLabel}{a.identifier ? ` · ${a.identifier}` : ''} · {a.unitName ?? 'No station'}</p>
            </li>
          ))}
        </ul>
      )}
      {canManage && data.types.length > 0 && (
        <Card title="Add an asset">
          <AddAssetForm types={data.types.map((t) => ({ id: t.id, label: t.label }))} units={data.units} defs={data.defs} />
        </Card>
      )}
    </div>
  );
}
