import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { loadTrades, loadUpcomingShifts, tradeBlocks, type TradeShift, type TradeView } from '@/server/scheduling/trades';
import { ApproveForm, DenyForm, ProposeTradeForm, RespondForm, WithdrawForm } from './forms';

function when(s: TradeShift): string {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: s.tz, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return fmt.format(s.start);
}
const describe = (s: TradeShift) => `${when(s)} · ${s.unit} ${s.seat}`;

const STATUS: Record<string, string> = {
  awaiting_member: 'Waiting for the other member',
  awaiting_approval: 'Waiting for an officer',
  approved: 'Approved',
  denied: 'Denied',
  declined: 'Declined',
  cancelled: 'Withdrawn',
};

function Swap({ t }: { t: TradeView }) {
  return (
    <div className="space-y-1">
      <p><span className="font-medium">{t.mine.memberName}</span> gives {describe(t.mine)}</p>
      <p><span className="font-medium">{t.theirs.memberName}</span> gives {describe(t.theirs)}</p>
      {t.note && <p className="text-sm text-muted">Note: {t.note}</p>}
    </div>
  );
}

export default async function TradesPage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('scheduling')) return <Forbidden reason="scheduling is not enabled for this department" />;
  const canRequest = hasAny(ctx, 'scheduling.trade.request');
  const canApprove = hasAny(ctx, 'scheduling.roster.edit');
  if (!canRequest && !canApprove) return <Forbidden reason="no permission to trade shifts" />;

  const data = await withCtxDb(ctx, async (tx) => {
    const trades = await loadTrades(tx);
    const blocks: Record<string, string[]> = {};
    for (const t of trades) if (t.canDecide && t.status === 'awaiting_approval') blocks[t.id] = await tradeBlocks(tx, t.id);
    return {
      trades: [...trades],
      blocks,
      mine: canRequest ? await loadUpcomingShifts(tx, 'mine') : [],
      others: canRequest ? await loadUpcomingShifts(tx, 'others') : [],
    };
  });

  const offers = data.trades.filter((t) => t.status === 'awaiting_member' && t.iAmCounterparty);
  const open = data.trades.filter((t) => ['awaiting_member', 'awaiting_approval'].includes(t.status) && (t.iAmRequester || t.iAmCounterparty) && !offers.includes(t));
  const approvals = data.trades.filter((t) => t.status === 'awaiting_approval' && t.canDecide);
  const recent = data.trades.filter((t) => !['awaiting_member', 'awaiting_approval'].includes(t.status)).slice(0, 10);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Shift trades</h1>
      <p className="text-muted">
        Trade one of your upcoming shifts for someone else’s. They must accept, then an officer covering both stations approves it
        and the roster is updated.
      </p>

      {canRequest && (
        <Card title="Propose a trade">
          {data.mine.length === 0 || data.others.length === 0
            ? <p>There are no upcoming shifts to trade right now.</p>
            : <ProposeTradeForm mine={data.mine.map((s) => ({ id: s.id, label: describe(s) }))} others={data.others.map((s) => ({ id: s.id, label: `${s.memberName} — ${describe(s)}` }))} />}
        </Card>
      )}

      {offers.length > 0 && (
        <section aria-labelledby="offers">
          <h2 id="offers" className="mb-3 text-lg font-semibold">Offers to you</h2>
          <ul aria-label="Trade offers to you" className="space-y-3">
            {offers.map((t) => (
              <li key={t.id} className="rounded-lg border border-line bg-surface p-4">
                <Swap t={t} />
                <div className="mt-3 flex flex-wrap gap-3">
                  <RespondForm id={t.id} accept who={t.mine.memberName} />
                  <RespondForm id={t.id} accept={false} who={t.mine.memberName} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {open.length > 0 && (
        <section aria-labelledby="mine">
          <h2 id="mine" className="mb-3 text-lg font-semibold">Your pending trades</h2>
          <ul aria-label="Your pending trades" className="space-y-3">
            {open.map((t) => (
              <li key={t.id} className="rounded-lg border border-line bg-surface p-4">
                <Swap t={t} />
                <p className="mt-2 text-sm font-medium">{STATUS[t.status]}</p>
                <div className="mt-2"><WithdrawForm id={t.id} who={t.iAmRequester ? t.theirs.memberName : t.mine.memberName} /></div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canApprove && (
        <section aria-labelledby="approvals">
          <h2 id="approvals" className="mb-3 text-lg font-semibold">Trades to approve</h2>
          {approvals.length === 0 ? <p>No trades are waiting for you.</p> : (
            <ul aria-label="Trades to approve" className="space-y-3">
              {approvals.map((t) => {
                const label = `${t.mine.memberName} and ${t.theirs.memberName}`;
                const blocks = data.blocks[t.id] ?? [];
                return (
                  <li key={t.id} className="rounded-lg border border-line bg-surface p-4">
                    <Swap t={t} />
                    {blocks.length > 0 && (
                      <div role="note" className="mt-2 rounded-md border border-line p-3 text-sm">
                        <p className="font-medium">Qualification blocks</p>
                        <ul className="list-disc pl-5">{blocks.map((b) => <li key={b}>{b}</li>)}</ul>
                      </div>
                    )}
                    <div className="mt-3 space-y-3">
                      <ApproveForm id={t.id} label={label} />
                      <DenyForm id={t.id} label={label} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {recent.length > 0 && (
        <section aria-labelledby="recent">
          <h2 id="recent" className="mb-3 text-lg font-semibold">Recent trades</h2>
          <ul aria-label="Recent trades" className="space-y-3">
            {recent.map((t) => (
              <li key={t.id} className="rounded-lg border border-line bg-surface p-4">
                <Swap t={t} />
                <p className="mt-2 text-sm font-medium">{STATUS[t.status]}{t.decisionNote ? ` — ${t.decisionNote}` : ''}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
