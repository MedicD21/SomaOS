import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { getRequestContext, withCtxDb } from '@/server/context';
import { custodyAccess, when } from '@/server/custody/access';
import { loadCsLocations } from '@/server/custody/catalog';
import { loadCountSheet, loadRecentCounts } from '@/server/custody/counts';
import { loadWitnessCandidates } from '@/server/custody/ledger';
import { CountForm } from '../forms';
import { CustodyNav } from '../subnav';

export default async function CountsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getRequestContext();
  const a = custodyAccess(ctx);
  if (!a.enabled) return <Forbidden reason="custody is not enabled for this department" />;
  if (!a.any) return <Forbidden reason="a custody permission is required" />;

  const data = await withCtxDb(ctx, async (tx) => {
    const locations = await loadCsLocations(tx);
    const location = locations.find((l) => l.id === sp.location) ?? locations[0] ?? null;
    let sheet: Awaited<ReturnType<typeof loadCountSheet>> = [];
    let canCount = false;
    if (location && a.record) {
      try {
        sheet = await loadCountSheet(tx, location.id);
        canCount = true;
      } catch {
        canCount = false;   // no record permission at this unit
      }
    }
    return {
      locations,
      location,
      sheet,
      canCount,
      witnesses: location && canCount ? await loadWitnessCandidates(tx, location.id) : [],
      recent: await loadRecentCounts(tx),
    };
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Counts</h1>
      <CustodyNav />
      <p className="text-muted">A count is blind: you enter what you see, a witness confirms it, and the system compares it with the record. Any difference opens a discrepancy for a custody manager.</p>

      <form method="get" aria-label="Choose location" className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="cnt-location" className="block text-sm font-medium">Location</label>
          <select id="cnt-location" name="location" defaultValue={data.location?.id} className="block min-h-11 max-w-full rounded-md border border-line bg-surface px-3 py-2">
            {data.locations.map((l) => <option key={l.id} value={l.id}>{l.unitName} · {l.name}</option>)}
          </select>
        </div>
        <button type="submit" className="min-h-11 rounded-md border border-line px-4 text-sm font-medium">Show</button>
      </form>

      {data.location && a.record && (
        <Card title={`Count ${data.location.name}`}>
          {!data.canCount ? <p>You cannot count at this location.</p>
            : data.sheet.length === 0 ? <p>Nothing is held here, so there is nothing to count.</p>
            : <CountForm locationId={data.location.id} hasSeal={data.location.seal !== null} witnesses={data.witnesses.map((w) => ({ id: w.id, label: w.name }))}
                sheet={data.sheet.map((l) => ({ lotId: l.lotId, label: `${l.itemName} · lot ${l.lotNo} · exp ${l.expiresOn} (${l.unit})` }))} />}
        </Card>
      )}

      <section aria-labelledby="recent">
        <h2 id="recent" className="mb-3 text-lg font-semibold">Recent counts</h2>
        {data.recent.length === 0 ? <p>No counts yet.</p> : (
          <ul aria-label="Recent counts" className="space-y-2">
            {data.recent.map((c) => (
              <li key={c.id} className="rounded-lg border border-line bg-surface p-3 text-sm">
                <span className="font-medium">{c.locationName}</span> · {when(c.at)} · counted by {c.countedBy}, witnessed by {c.witness} · {c.lines} lot{c.lines === 1 ? '' : 's'}
                {c.discrepancies > 0 ? <span className="ml-2 font-semibold text-danger">{c.discrepancies} discrepanc{c.discrepancies === 1 ? 'y' : 'ies'}</span> : <span className="ml-2">Matched</span>}
                {!c.sealOk && <span className="ml-2 font-semibold text-danger">Seal mismatch</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
