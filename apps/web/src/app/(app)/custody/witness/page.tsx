import { Forbidden } from '@/components/forbidden';
import { getRequestContext, withCtxDb } from '@/server/context';
import { custodyAccess, num, when } from '@/server/custody/access';
import { loadCsLocations, loadCsLots } from '@/server/custody/catalog';
import { loadWitnessRequests, type WitnessRequest } from '@/server/custody/ledger';
import { CompleteWitnessedForm, ConfirmWitnessForm, DeclineWitnessForm } from '../forms';
import { CustodyNav } from '../subnav';

const q = (v: unknown) => num(Number(v));

export default async function WitnessPage() {
  const ctx = await getRequestContext();
  const a = custodyAccess(ctx);
  if (!a.enabled) return <Forbidden reason="custody is not enabled for this department" />;
  if (!a.record && !a.witness && !a.manage) return <Forbidden reason="custody.record or custody.witness is required" />;

  const data = await withCtxDb(ctx, async (tx) => ({
    requests: await loadWitnessRequests(tx),
    lots: await loadCsLots(tx),
    locations: await loadCsLocations(tx, true),
  }));
  const lot = (id: unknown) => {
    const l = data.lots.find((x) => x.id === id);
    return l ? `${l.itemName} lot ${l.lotNo}` : 'a lot';
  };
  const loc = (id: unknown) => data.locations.find((x) => x.id === id)?.name ?? 'a location';

  function describe(r: WitnessRequest): string {
    const p = r.payload;
    switch (r.action) {
      case 'waste': return `Waste ${q(p.qty)} of ${lot(p.lot)} at ${loc(p.location)}: ${String(p.reason)}`;
      case 'transfer': return `Transfer ${q(p.qty)} of ${lot(p.lot)} from ${loc(p.from)} to ${loc(p.to)}`;
      case 'return': return `Return ${q(p.qty)} of ${lot(p.lot)} from ${loc(p.from)} to ${loc(p.to)}`;
      case 'seal_break': return `Break the seal on ${loc(p.location)} and apply ${String(p.new_seal_no)}: ${String(p.reason)}`;
      case 'count': return `Count at ${loc(p.location)}: ${Array.isArray(p.lines) ? p.lines.length : 0} lot(s)`;
      case 'adjust': return `Adjust ${q(p.delta)} of ${lot(p.lot)} at ${loc(p.location)}: ${String(p.reason)}`;
      default: return r.action;
    }
  }

  const toWitness = data.requests.filter((r) => r.forMe && r.status === 'pending' && !r.expired);
  const mine = data.requests.filter((r) => r.mine);
  const state = (r: WitnessRequest) =>
    r.consumed ? 'Completed' : r.status === 'declined' ? 'Declined' : r.expired ? 'Expired' : r.status === 'confirmed' ? 'Confirmed: ready to complete' : 'Waiting for the witness';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Witness requests</h1>
      <CustodyNav />
      <p className="text-muted">A witness confirms from their own sign-in; you then complete the action. Requests expire after 30 minutes.</p>

      <section aria-labelledby="towitness">
        <h2 id="towitness" className="mb-3 text-lg font-semibold">Waiting for you to witness</h2>
        {toWitness.length === 0 ? <p>Nothing is waiting for you.</p> : (
          <ul aria-label="Requests to witness" className="space-y-3">
            {toWitness.map((r) => (
              <li key={r.id} className="rounded-lg border border-line bg-surface p-4">
                <p className="font-medium">{describe(r)}</p>
                <p className="text-sm text-muted">Requested by {r.requestedBy} · expires {when(r.expiresAt)}</p>
                <div className="mt-3 space-y-3">
                  <ConfirmWitnessForm id={r.id} label={describe(r)} />
                  <DeclineWitnessForm id={r.id} label={describe(r)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="mine">
        <h2 id="mine" className="mb-3 text-lg font-semibold">My requests</h2>
        {mine.length === 0 ? <p>You have not asked anyone to witness.</p> : (
          <ul aria-label="My requests" className="space-y-3">
            {mine.map((r) => (
              <li key={r.id} className="rounded-lg border border-line bg-surface p-4">
                <p className="font-medium">{describe(r)}</p>
                <p className="text-sm text-muted">Witness {r.witness} · {state(r)}</p>
                {r.status === 'confirmed' && !r.consumed && !r.expired && <div className="mt-3"><CompleteWitnessedForm id={r.id} label={describe(r)} /></div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
