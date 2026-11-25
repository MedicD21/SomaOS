import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { loadCsItems, loadCsLocations, loadCsLots, loadMembersLite, loadUnits } from '@/server/custody/catalog';
import { AddItemForm, AddLocationForm, AddLotForm, ArchiveLocationForm, ArchiveLotForm, RecallForm } from './forms';

export default async function CustodyAdminPage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('custody')) return <Forbidden reason="custody is not enabled for this department" />;
  if (!hasAny(ctx, 'custody.manage')) return <Forbidden reason="custody.manage is required" />;

  const data = await withCtxDb(ctx, async (tx) => ({
    items: await loadCsItems(tx),
    lots: await loadCsLots(tx),
    locations: await loadCsLocations(tx, true),
    units: await loadUnits(tx),
    members: await loadMembersLite(tx),
  }));
  const activeItems = data.items.filter((i) => !i.archived).map((i) => ({ id: i.id, label: `${i.name} (${i.unit})` }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Custody</h1>
      <p className="text-muted">Medications, lots and locations for controlled-substance custody. Nothing is deleted: archive a lot or location once it holds nothing.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Add medication"><AddItemForm /></Card>
        {activeItems.length > 0 && <Card title="Add lot"><AddLotForm items={activeItems} /></Card>}
        <Card title="Add custody location"><AddLocationForm units={data.units.map((u) => ({ id: u.id, label: u.name }))} members={data.members.map((m) => ({ id: m.id, label: m.name }))} /></Card>
      </div>

      <section aria-labelledby="lots">
        <h2 id="lots" className="mb-3 text-lg font-semibold">Medications and lots</h2>
        {data.lots.length === 0 ? <p>No lots yet.</p> : (
          <ul aria-label="Lots" className="space-y-3">
            {data.lots.map((l) => (
              <li key={l.id} className="rounded-lg border border-line bg-surface p-4">
                <p className="font-medium">{l.itemName} · lot {l.lotNo} <span className="text-sm font-normal text-muted">expires {l.expiresOn}</span></p>
                {l.recalled && <p className="text-sm font-semibold text-danger">Recalled{l.recallNote ? `: ${l.recallNote}` : ''}</p>}
                {l.archived && <p className="text-sm text-muted">Archived</p>}
                {!l.archived && !l.recalled && <details className="mt-2"><summary className="cursor-pointer text-sm underline">Recall this lot</summary><div className="mt-2"><RecallForm lotId={l.id} label={`${l.itemName} lot ${l.lotNo}`} /></div></details>}
                {!l.archived && <ArchiveLotForm id={l.id} label={`${l.itemName} lot ${l.lotNo}`} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="locs">
        <h2 id="locs" className="mb-3 text-lg font-semibold">Locations</h2>
        {data.locations.length === 0 ? <p>No locations yet.</p> : (
          <ul aria-label="Custody locations" className="space-y-3">
            {data.locations.map((l) => (
              <li key={l.id} className="rounded-lg border border-line bg-surface p-4">
                <p className="font-medium">{l.name} <span className="text-sm font-normal text-muted">{l.unitName} · {l.kind.replace('_', ' ')}{l.memberName ? ` · ${l.memberName}` : ''}</span></p>
                {l.archived ? <p className="text-sm text-muted">Archived</p> : <ArchiveLocationForm id={l.id} label={l.name} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
