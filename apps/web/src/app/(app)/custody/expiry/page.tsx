import Link from 'next/link';
import { Forbidden } from '@/components/forbidden';
import { getRequestContext, withCtxDb } from '@/server/context';
import { custodyAccess, num } from '@/server/custody/access';
import { loadExpiring, loadRecalled } from '@/server/custody/counts';
import { CustodyNav } from '../subnav';

const WINDOWS = [30, 60, 90];

export default async function ExpiryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getRequestContext();
  const a = custodyAccess(ctx);
  if (!a.enabled) return <Forbidden reason="custody is not enabled for this department" />;
  if (!a.any) return <Forbidden reason="a custody permission is required" />;
  const days = WINDOWS.includes(Number(sp.days)) ? Number(sp.days) : 90;

  const data = await withCtxDb(ctx, async (tx) => ({ expiring: await loadExpiring(tx, days), recalled: await loadRecalled(tx) }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Expiry and recalls</h1>
      <CustodyNav />

      <section aria-labelledby="expiring">
        <h2 id="expiring" className="mb-2 text-lg font-semibold">Expiring within {days} days</h2>
        <p className="mb-3 flex flex-wrap gap-3 text-sm">
          {WINDOWS.map((w) => <Link key={w} className={w === days ? 'font-semibold underline' : 'underline'} href={`/custody/expiry?days=${w}`}>{w} days</Link>)}
        </p>
        {data.expiring.length === 0 ? <p>Nothing held expires in that time.</p> : (
          <ul aria-label="Expiring lots" className="space-y-2">
            {data.expiring.map((r) => (
              <li key={`${r.locationId}-${r.lotNo}-${r.itemName}`} className="rounded-lg border border-line bg-surface p-3 text-sm">
                <span className="font-medium">{r.itemName}</span> lot {r.lotNo} at {r.locationName}: {num(r.onHand)} on hand · expires {r.expiresOn}
                {r.daysLeft < 0 ? <span className="ml-2 font-semibold text-danger">Expired</span> : <span className="ml-2">{r.daysLeft} days</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="recalled">
        <h2 id="recalled" className="mb-3 text-lg font-semibold">Recalled lots still held</h2>
        {data.recalled.length === 0 ? <p>No recalled lot is held.</p> : (
          <ul aria-label="Recalled lots" className="space-y-2">
            {data.recalled.map((r) => (
              <li key={`${r.locationId}-${r.lotNo}-${r.itemName}`} className="rounded-lg border border-line bg-surface p-3 text-sm">
                <span className="font-medium">{r.itemName}</span> lot {r.lotNo} at {r.locationName}: {num(r.onHand)} on hand{r.note ? ` · ${r.note}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
