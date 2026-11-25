import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { getRequestContext, withCtxDb } from '@/server/context';
import { custodyAccess, num, when } from '@/server/custody/access';
import { loadCsLocations } from '@/server/custody/catalog';
import { chainStatus, loadLedger, loadSealEvents, loadWitnessCandidates } from '@/server/custody/ledger';
import { SealApplyForm, SealBreakForm, SealVerifyForm } from '../forms';
import { CustodyNav } from '../subnav';

const TYPE: Record<string, string> = {
  receive: 'Received', transfer_out: 'Transferred out', transfer_in: 'Transferred in', return_out: 'Returned out', return_in: 'Returned in',
  administer: 'Administered', waste: 'Wasted', adjust: 'Adjusted',
};

export default async function CustodyLocationPage({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params;
  if (!z.uuid().safeParse(locationId).success) notFound();
  const ctx = await getRequestContext();
  const a = custodyAccess(ctx);
  if (!a.enabled) return <Forbidden reason="custody is not enabled for this department" />;
  if (!a.any) return <Forbidden reason="a custody permission is required" />;

  const data = await withCtxDb(ctx, async (tx) => {
    const location = (await loadCsLocations(tx, true)).find((l) => l.id === locationId);
    if (!location) return null;
    return {
      location,
      ledger: await loadLedger(tx, locationId),
      seals: await loadSealEvents(tx, locationId),
      chain: await chainStatus(tx, locationId),
      witnesses: a.record || a.manage ? await loadWitnessCandidates(tx, locationId) : [],
    };
  });
  if (!data) notFound();
  const { location } = data;
  const witnesses = data.witnesses.map((w) => ({ id: w.id, label: w.name }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{location.name}</h1>
      <CustodyNav />
      <p className="text-muted">{location.unitName} · {location.kind.replace('_', ' ')}{location.memberName ? ` · ${location.memberName}` : ''}{location.archived ? ' · archived' : ''}</p>
      <p><Link className="underline" href={`/custody?location=${location.id}`}>Back to this location’s stock and actions</Link></p>

      <section aria-labelledby="chain">
        <h2 id="chain" className="mb-2 text-lg font-semibold">Record integrity</h2>
        {data.chain === null ? <p>The integrity check is available to auditors and custody managers.</p>
          : data.chain.ok ? <p role="status">The record chain verifies: no entry has been altered.</p>
          : <p role="alert" className="font-semibold text-danger">The record chain does not verify at entry {data.chain.brokenSeq}. Report this to your custody manager.</p>}
      </section>

      <section aria-labelledby="seals">
        <h2 id="seals" className="mb-2 text-lg font-semibold">Seal</h2>
        <p>{location.seal ? `Current seal: ${location.seal}` : location.kind === 'drug_box' ? 'No seal is applied.' : 'Seals apply to drug boxes.'}</p>
        {location.kind === 'drug_box' && !location.archived && (a.record || a.manage) && (
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            {!location.seal && <Card title="Apply a seal"><SealApplyForm locationId={location.id} /></Card>}
            {location.seal && <Card title="Check the seal"><SealVerifyForm locationId={location.id} /></Card>}
            {location.seal && <Card title="Break the seal (witnessed)"><SealBreakForm locationId={location.id} witnesses={witnesses} /></Card>}
          </div>
        )}
        {data.seals.length > 0 && (
          <ul aria-label="Seal history" className="mt-3 space-y-1 text-sm">
            {data.seals.map((e) => (
              <li key={e.id}>{when(e.at)} · {e.kind} {e.sealNo}{e.ok === false ? ' · did not match' : ''} · {e.by}{e.witness ? ` (witness ${e.witness})` : ''}{e.reason ? ` · ${e.reason}` : ''}</li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ledger">
        <h2 id="ledger" className="mb-3 text-lg font-semibold">Custody record</h2>
        {data.ledger.length === 0 ? <p>No movements yet.</p> : (
          <ul aria-label="Custody record" className="space-y-2">
            {data.ledger.map((r) => (
              <li key={r.id} className="rounded-lg border border-line bg-surface p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{TYPE[r.type] ?? r.type} {num(Math.abs(r.delta))} · {r.itemName} lot {r.lotNo}</span>
                  <span className="text-muted">#{r.seq} · {when(r.at)}</span>
                </div>
                <p>By {r.by}{r.witness ? `, witnessed by ${r.witness}` : ''}{r.reference ? ` · ref ${r.reference}` : ''}{r.reason ? ` · ${r.reason}` : ''}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
