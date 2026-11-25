import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { loadUnits } from '@/server/inventory/assets';
import { loadItems, loadLocations } from '@/server/inventory/stock';
import { AddItemForm, AddLocationForm, ArchiveItemForm, ArchiveLocationForm } from '../../inventory/forms';

export default async function InventoryAdminPage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('inventory')) return <Forbidden reason="assets and inventory are not enabled for this department" />;
  const d = check(ctx, 'inventory.stock.manage');
  if (!d.allowed) return <Forbidden reason={d.reason} />;
  const data = await withCtxDb(ctx, async (tx) => ({ items: await loadItems(tx, true), locations: await loadLocations(tx, true), units: await loadUnits(tx) }));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Items and locations</h1>
      <p className="text-muted">The supplies you stock and where they live. Archiving keeps all history.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Add an item"><AddItemForm /></Card>
        <Card title="Add a location">
          <AddLocationForm parents={data.locations.filter((l) => !l.archived).map((l) => ({ id: l.id, label: l.path }))} units={data.units} />
        </Card>
      </div>
      <section aria-labelledby="items">
        <h2 id="items" className="mb-3 text-lg font-semibold">Items</h2>
        <ul aria-label="Items" className="space-y-2">
          {data.items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3">
              <span><span className="font-medium">{i.name}</span> <span className="text-sm text-muted">· {i.unit}{i.archived ? ' · archived' : ''}</span></span>
              <ArchiveItemForm id={i.id} label={i.name} archived={i.archived} />
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="locations">
        <h2 id="locations" className="mb-3 text-lg font-semibold">Locations</h2>
        <ul aria-label="Locations" className="space-y-2">
          {data.locations.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3">
              <span><span className="font-medium">{l.path}</span> <span className="text-sm text-muted">· {l.kind}{l.archived ? ' · archived' : ''}</span></span>
              {!l.archived && <ArchiveLocationForm id={l.id} label={l.path} />}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
