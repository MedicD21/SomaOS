import type { AccrualSim, PaySim, PaySimColumn, PatternSim, SimResult } from './sim-types';

const usd = (n: number | null): string => (n === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n));
const hrs = (n: number): string => `${Math.round(n * 100) / 100} h`;
const delta = (a: number | null, b: number | null, fmt: (n: number) => string): string => {
  if (a === null || b === null) return '—';
  const d = Math.round((b - a) * 100) / 100;
  return d === 0 ? 'No change' : `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}`;
};

function Cell({ c, what }: { c: PaySimColumn | null; what: 'hours' | 'amount' }) {
  if (!c) return <span className="text-muted">—</span>;
  if (c.problem) return what === 'hours' ? <span className="text-sm text-muted">{c.problem}</span> : <span className="text-muted">—</span>;
  return <>{what === 'hours' ? hrs(c.hours) : usd(c.amount)}</>;
}

function PayResult({ sim }: { sim: PaySim }) {
  return (
    <div className="space-y-3">
      <div className="relative max-w-full overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <caption className="mb-2 text-left font-medium">{sim.heading}: approved rules and the draft side by side</caption>
          <thead>
            <tr>
              <th scope="col" className="py-2 pr-3">Member</th>
              <th scope="col" className="pr-3">Approved hours</th>
              <th scope="col" className="pr-3">Approved pay</th>
              <th scope="col" className="pr-3">Draft hours</th>
              <th scope="col" className="pr-3">Draft pay</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {sim.rows.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <th scope="row" className="py-2 pr-3 font-medium">
                  {r.name}
                  {(r.approved?.lines.length || r.draft?.lines.length) ? (
                    <details className="font-normal">
                      <summary className="cursor-pointer text-xs underline">Show pay codes for {r.name}</summary>
                      <ul className="mt-1 space-y-1 text-xs">
                        <li>Approved: {r.approved?.lines.map((l) => `${l.code} ${hrs(l.hours)} at ${l.multiplier}×`).join(', ') || 'none'}</li>
                        <li>Draft: {r.draft?.lines.map((l) => `${l.code} ${hrs(l.hours)} at ${l.multiplier}×`).join(', ') || 'none'}</li>
                        {r.draft && r.draft.compHours > 0 && <li>Draft comp time: {hrs(r.draft.compHours)}</li>}
                      </ul>
                    </details>
                  ) : null}
                </th>
                <td className="pr-3 py-2"><Cell c={r.approved} what="hours" /></td>
                <td className="pr-3 py-2"><Cell c={r.approved} what="amount" /></td>
                <td className="pr-3 py-2"><Cell c={r.draft} what="hours" /></td>
                <td className="pr-3 py-2"><Cell c={r.draft} what="amount" /></td>
                <td className="py-2 font-medium">{r.approved && r.draft && !r.approved.problem && !r.draft.problem ? delta(r.approved.amount, r.draft.amount, usd) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line font-semibold">
              <th scope="row" className="py-2 pr-3">Total</th>
              <td className="pr-3">{hrs(sim.totals.approvedHours)}</td>
              <td className="pr-3">{usd(sim.totals.approvedAmount)}</td>
              <td className="pr-3">{hrs(sim.totals.draftHours)}</td>
              <td className="pr-3">{usd(sim.totals.draftAmount)}</td>
              <td>{delta(sim.totals.approvedAmount, sim.totals.draftAmount, usd)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function AccrualResult({ sim }: { sim: AccrualSim }) {
  return (
    <div className="relative max-w-full overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <caption className="mb-2 text-left font-medium">{sim.heading}: approved policy and the draft side by side</caption>
        <thead>
          <tr>
            <th scope="col" className="py-2 pr-3">Period starting</th>
            <th scope="col" className="pr-3">Approved earns</th>
            <th scope="col" className="pr-3">Approved balance</th>
            <th scope="col" className="pr-3">Draft earns</th>
            <th scope="col" className="pr-3">Draft balance</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {sim.rows.map((r) => (
            <tr key={r.period} className="border-t border-line align-top">
              <th scope="row" className="py-2 pr-3 font-medium whitespace-nowrap">{r.period}</th>
              <td className="pr-3 py-2">{r.approved ? hrs(r.approved.hours) : '—'}</td>
              <td className="pr-3 py-2">{r.approved ? hrs(r.approved.balanceAfter) : '—'}</td>
              <td className="pr-3 py-2">{r.draft ? hrs(r.draft.hours) : '—'}</td>
              <td className="pr-3 py-2">{r.draft ? hrs(r.draft.balanceAfter) : '—'}</td>
              <td className="py-2 text-xs">
                {r.draft?.capped && <span className="block">Draft: at the cap</span>}
                {r.draft && r.draft.expired > 0 && <span className="block">Draft: {hrs(r.draft.expired)} forfeited at the reset</span>}
                {r.approved?.capped && <span className="block">Approved: at the cap</span>}
                {r.approved && r.approved.expired > 0 && <span className="block">Approved: {hrs(r.approved.expired)} forfeited at the reset</span>}
                <details>
                  <summary className="cursor-pointer underline">Why</summary>
                  <ul className="mt-1 space-y-1">{r.explain.map((e) => <li key={e}>{e}</li>)}</ul>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PatternResult({ sim }: { sim: PatternSim }) {
  const change = (d: PatternSim['days'][number]): string => (d.draft && !d.approved ? 'Added' : d.approved && !d.draft ? 'Removed' : '');
  return (
    <div className="space-y-3">
      <p className="text-sm">
        <strong>{sim.added.length}</strong> day{sim.added.length === 1 ? '' : 's'} added, <strong>{sim.removed.length}</strong> removed.
        On duty {hrs(sim.approvedHours)} now, {hrs(sim.draftHours)} with the draft.
        Approving would withdraw <strong>{sim.replaced}</strong> generated shift{sim.replaced === 1 ? '' : 's'} from tomorrow; regenerate the roster afterwards.
      </p>
      <div className="relative max-h-80 max-w-full overflow-auto">
        <table className="w-full text-left text-sm">
          <caption className="mb-2 text-left font-medium">{sim.heading}</caption>
          <thead>
            <tr>
              <th scope="col" className="py-2 pr-3">Date</th>
              <th scope="col" className="pr-3">Approved</th>
              <th scope="col" className="pr-3">Draft</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {sim.days.map((d) => (
              <tr key={d.date} className="border-t border-line">
                <th scope="row" className="py-1 pr-3 font-medium whitespace-nowrap">{d.date}</th>
                <td className="pr-3">{d.approved ? 'On duty' : 'Off'}</td>
                <td className="pr-3">{d.draft ? 'On duty' : 'Off'}</td>
                <td className="font-medium">{change(d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Draft versus approved, as real tables. Rendered from a result the server already computed. */
export function SimulationResult({ sim }: { sim: SimResult }) {
  return (
    <div className="space-y-3" data-testid="simulation-result">
      {sim.kind === 'pay' && <PayResult sim={sim} />}
      {sim.kind === 'accrual' && <AccrualResult sim={sim} />}
      {sim.kind === 'pattern' && <PatternResult sim={sim} />}
      {sim.notes.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{sim.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      )}
    </div>
  );
}
