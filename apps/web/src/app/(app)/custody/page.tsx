import Link from 'next/link';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { getRequestContext, withCtxDb } from '@/server/context';
import { custodyAccess, num } from '@/server/custody/access';
import { loadCsLocations, loadCsLots } from '@/server/custody/catalog';
import { loadBalances, loadWitnessCandidates, loadWitnessRequests } from '@/server/custody/ledger';
import { AdministerForm, MoveForm, ReceiveForm, WasteForm } from './forms';
import { CustodyNav, TestModeNotice } from './subnav';

export default async function CustodyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getRequestContext();
  const a = custodyAccess(ctx);
  if (!a.enabled) return <Forbidden reason="custody is not enabled for this department" />;
  if (!a.any) return <Forbidden reason="a custody permission is required" />;

  const data = await withCtxDb(ctx, async (tx) => {
    const locations = await loadCsLocations(tx);
    const location = locations.find((l) => l.id === sp.location) ?? locations[0] ?? null;
    return {
      locations,
      location,
      lots: await loadCsLots(tx),
      balances: location ? await loadBalances(tx, location.id) : [],
      witnesses: location && (a.record || a.manage) ? await loadWitnessCandidates(tx, location.id) : [],
      requests: await loadWitnessRequests(tx),
    };
  });
  const lotLabel = (l: { itemName: string; lotNo: string; unit: string; expiresOn: string }) => `${l.itemName} · lot ${l.lotNo} · exp ${l.expiresOn} (${l.unit})`;
  const held = data.balances.filter((b) => b.onHand > 0).map((b) => ({ ...b, lot: data.lots.find((l) => l.id === b.lotId) })).filter((b) => b.lot);
  const usable = data.lots.filter((l) => !l.archived && !l.recalled);
  const toWitness = data.requests.filter((r) => r.forMe && r.status === 'pending' && !r.expired).length;
  const toComplete = data.requests.filter((r) => r.mine && r.status === 'confirmed' && !r.consumed && !r.expired).length;
  const witnesses = data.witnesses.map((w) => ({ id: w.id, label: w.name }));
  const lotOpts = (list: { id: string; itemName: string; lotNo: string; unit: string; expiresOn: string }[]) => list.map((l) => ({ id: l.id, label: lotLabel(l) }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Custody</h1>
      <TestModeNotice />
      <CustodyNav />
      {(toWitness > 0 || toComplete > 0) && (
        <p role="status" className="rounded-md border border-line p-3">
          {toWitness > 0 && <>You have {toWitness} request{toWitness === 1 ? '' : 's'} to witness. </>}
          {toComplete > 0 && <>{toComplete} of your request{toComplete === 1 ? ' is' : 's are'} confirmed and ready to complete. </>}
          <Link className="underline" href="/custody/witness">Open witness requests</Link>
        </p>
      )}

      <form method="get" aria-label="Choose location" className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="cs-location" className="block text-sm font-medium">Location</label>
          <select id="cs-location" name="location" defaultValue={data.location?.id} className="block min-h-11 max-w-full rounded-md border border-line bg-surface px-3 py-2">
            {data.locations.map((l) => <option key={l.id} value={l.id}>{l.unitName} · {l.name}</option>)}
          </select>
        </div>
        <button type="submit" className="min-h-11 rounded-md border border-line px-4 text-sm font-medium">Show</button>
      </form>

      {!data.location ? <p>No custody locations are in your scope yet.{a.manage ? <> Add one under <Link className="underline" href="/admin/custody">Admin → Custody</Link>.</> : ''}</p> : (
        <>
          <section aria-labelledby="held">
            <h2 id="held" className="mb-3 text-lg font-semibold">{data.location.name} <span className="text-sm font-normal text-muted">({data.location.unitName}, {data.location.kind.replace('_', ' ')})</span></h2>
            {data.location.seal && <p className="mb-2 text-sm">Seal {data.location.seal}</p>}
            {held.length === 0 ? <p>Nothing is held here.</p> : (
              <ul aria-label="Stock held" className="space-y-2">
                {held.map((b) => (
                  <li key={b.lotId} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-line bg-surface p-3">
                    <span className="font-medium">{lotLabel(b.lot!)}</span>
                    <span><strong>{num(b.onHand)}</strong> on hand{b.lot!.recalled ? <span className="ml-2 font-semibold text-danger">Recalled</span> : null}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2"><Link className="underline" href={`/custody/${data.location.id}`}>Open the record, seal and chain check</Link></p>
          </section>

          {a.record && (
            <div className="grid gap-4 lg:grid-cols-2">
              {usable.length > 0 && <Card title="Receive stock"><ReceiveForm locationId={data.location.id} lots={lotOpts(usable)} /></Card>}
              {held.length > 0 && <Card title="Administered"><AdministerForm locationId={data.location.id} lots={lotOpts(held.map((h) => h.lot!))} /></Card>}
              {held.length > 0 && (
                <Card title="Transfer stock">
                  <MoveForm kind="transfer" fromId={data.location.id} lots={lotOpts(held.map((h) => h.lot!))} witnesses={witnesses}
                    locations={data.locations.filter((l) => l.id !== data.location!.id).map((l) => ({ id: l.id, label: `${l.unitName} · ${l.name}` }))} />
                </Card>
              )}
              {held.length > 0 && (
                <Card title="Return stock">
                  <MoveForm kind="return" fromId={data.location.id} lots={lotOpts(held.map((h) => h.lot!))} witnesses={witnesses}
                    locations={data.locations.filter((l) => l.id !== data.location!.id).map((l) => ({ id: l.id, label: `${l.unitName} · ${l.name}` }))} />
                </Card>
              )}
              {held.length > 0 && <Card title="Waste (witnessed)"><WasteForm locationId={data.location.id} lots={lotOpts(held.map((h) => h.lot!))} witnesses={witnesses} /></Card>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
