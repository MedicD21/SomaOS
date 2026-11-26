import Link from 'next/link';
import { Forbidden } from '@/components/forbidden';
import { getRequestContext, withCtxDb } from '@/server/context';
import { custodyAccess, num, when } from '@/server/custody/access';
import { loadDiscrepancies } from '@/server/custody/counts';
import { loadWitnessCandidates } from '@/server/custody/ledger';
import { EscalateForm, InvestigateForm, ResolveForm } from '../forms';
import { CustodyNav } from '../subnav';

const STATUS: Record<string, string> = { open: 'Open', investigating: 'Investigating', escalated: 'Escalated', resolved: 'Resolved' };
const KIND: Record<string, string> = { quantity: 'Quantity differs', seal: 'Seal mismatch', chain: 'Record integrity' };

export default async function DiscrepanciesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getRequestContext();
  const a = custodyAccess(ctx);
  if (!a.enabled) return <Forbidden reason="custody is not enabled for this department" />;
  if (!a.any) return <Forbidden reason="a custody permission is required" />;
  const showAll = sp.all === '1';

  const data = await withCtxDb(ctx, async (tx) => {
    const items = await loadDiscrepancies(tx, showAll);
    const witnesses: Record<string, { id: string; label: string }[]> = {};
    if (a.manage) {
      for (const loc of new Set(items.filter((d) => d.status !== 'resolved').map((d) => d.locationId))) {
        witnesses[loc] = (await loadWitnessCandidates(tx, loc)).map((w) => ({ id: w.id, label: w.name }));
      }
    }
    return { items, witnesses };
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Discrepancies</h1>
      <CustodyNav />
      <p className="text-muted">Any difference found in a count is recorded here and never deleted. A custody manager who did not do the count investigates and resolves it.</p>
      <p><Link className="underline" href={showAll ? '/custody/discrepancies' : '/custody/discrepancies?all=1'}>{showAll ? 'Show open only' : 'Include resolved'}</Link></p>

      {data.items.length === 0 ? <p>No discrepancies{showAll ? '' : ' are open'}.</p> : (
        <ul aria-label="Discrepancies" className="space-y-4">
          {data.items.map((d) => {
            const label = `${KIND[d.kind] ?? d.kind} at ${d.locationName}`;
            return (
              <li key={d.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{label}</span>
                  <span className="text-sm font-medium">{STATUS[d.status] ?? d.status}</span>
                </div>
                {d.kind === 'quantity' && <p>{d.itemName} lot {d.lotNo}: expected {num(d.expected ?? 0)}, counted {num(d.counted ?? 0)}</p>}
                <p className="text-sm text-muted">Opened {when(d.openedAt)}{d.countedBy ? ` · counted by ${d.countedBy}` : ''}</p>
                {d.events.length > 0 && (
                  <ul aria-label="History" className="mt-2 space-y-1 text-sm">
                    {d.events.map((e, i) => <li key={i}>{when(e.at)} · {e.kind} · {e.by}{e.note ? ` · ${e.note}` : ''}{e.reportRef ? ` · report ${e.reportRef}` : ''}</li>)}
                  </ul>
                )}
                {a.manage && d.status !== 'resolved' && (
                  <div className="mt-3 space-y-3">
                    <InvestigateForm id={d.id} label={label} />
                    <EscalateForm id={d.id} label={label} />
                    <ResolveForm id={d.id} label={label} canAdjust={d.kind === 'quantity'} witnesses={data.witnesses[d.locationId] ?? []} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
