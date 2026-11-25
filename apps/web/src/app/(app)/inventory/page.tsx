import Link from 'next/link';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { loadItems, loadLevels, loadLocations, loadLowStock } from '@/server/inventory/stock';
import { AdjustForm, ParForm, ReceiveForm, TransferForm, UseForm } from './forms';

const num = (n: number) => String(Math.round(n * 1000) / 1000);

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('inventory')) return <Forbidden reason="assets and inventory are not enabled for this department" />;
  if (!hasAny(ctx, 'inventory.stock.view')) return <Forbidden reason="inventory.stock.view is required" />;
  const canUse = hasAny(ctx, 'inventory.stock.use') || hasAny(ctx, 'inventory.stock.manage');
  const canManage = hasAny(ctx, 'inventory.stock.manage');

  const data = await withCtxDb(ctx, async (tx) => {
    const locations = await loadLocations(tx);
    const location = locations.find((l) => l.id === sp.location) ?? locations[0] ?? null;
    return { locations, location, items: await loadItems(tx), levels: location ? await loadLevels(tx, location.id) : [], low: await loadLowStock(tx) };
  });
  const itemName = new Map(data.items.map((i) => [i.id, `${i.name} (${i.unit})`]));
  const locName = new Map(data.locations.map((l) => [l.id, l.path]));
  const itemOpts = data.items.map((i) => ({ id: i.id, label: `${i.name} (${i.unit})` }));
  const locOpts = data.locations.map((l) => ({ id: l.id, label: l.path }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Inventory</h1>
      <form method="get" aria-label="Choose location" className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="inv-location" className="block text-sm font-medium">Location</label>
          <select id="inv-location" name="location" defaultValue={data.location?.id} className="block min-h-11 rounded-md border border-line bg-surface px-3 py-2">
            {locOpts.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </div>
        <button type="submit" className="min-h-11 rounded-md border border-line px-4 text-sm font-medium">Show</button>
      </form>

      {!data.location ? <p>No stock locations yet.{canManage ? <> Add one under <Link className="underline" href="/admin/inventory">Admin → Items and locations</Link>.</> : ''}</p> : (
        <>
          <section aria-labelledby="stock">
            <h2 id="stock" className="mb-3 text-lg font-semibold">Stock at {data.location.path}</h2>
            <ul aria-label="Stock levels" className="space-y-2">
              {data.levels.map((l) => (
                <li key={l.itemId} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-line bg-surface p-3">
                  <span className="font-medium">{itemName.get(l.itemId)}</span>
                  <span>
                    <strong>{num(l.onHand)}</strong> on hand{l.par !== null ? ` · par ${num(l.par)}` : ''}
                    {l.par !== null && l.onHand < l.par ? <span className="ml-2 font-semibold text-danger">{l.onHand <= (l.min ?? 0) ? 'Critical' : 'Low'}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {canUse && data.items.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Use stock"><UseForm locationId={data.location.id} items={itemOpts} /></Card>
              <Card title="Transfer stock"><TransferForm fromId={data.location.id} items={itemOpts} locations={locOpts} /></Card>
              {canManage && <Card title="Receive stock"><ReceiveForm locationId={data.location.id} items={itemOpts} /></Card>}
              {canManage && <Card title="Adjust stock"><AdjustForm locationId={data.location.id} items={itemOpts} /></Card>}
              {canManage && <Card title="Par level"><ParForm locationId={data.location.id} items={itemOpts} /></Card>}
            </div>
          )}
        </>
      )}

      <section aria-labelledby="low">
        <h2 id="low" className="mb-3 text-lg font-semibold">Low stock</h2>
        {data.low.length === 0 ? <p>Nothing is below par.</p> : (
          <ul aria-label="Low stock" className="space-y-2">
            {data.low.map((l) => (
              <li key={`${l.locationId}-${l.itemId}`} className="rounded-lg border border-line bg-surface p-3 text-sm">
                <span className="font-medium">{itemName.get(l.itemId)}</span> at {locName.get(l.locationId)}: {num(l.onHand)} of {num(l.par)} (short {num(l.shortBy)})
                {l.critical && <span className="ml-2 font-semibold text-danger">Critical</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
