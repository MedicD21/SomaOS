import Link from 'next/link';
import { addDays, localDateOf } from '@soma/schedule-engine';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { loadPayPeriod, payPeriodFor } from '@/server/pay/load';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const usd = (n: number | null) => (n === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n));
const hrs = (n: number) => `${Math.round(n * 100) / 100} h`;

function day(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export default async function PayPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('pay')) return <Forbidden reason="pay is not enabled for this department" />;
  const allowed = check(ctx, 'pay.view').allowed || check(ctx, 'pay.manage').allowed;
  if (!allowed) return <Forbidden reason="pay.view is required" />;

  const date = ISO.test(sp.start ?? '') ? sp.start! : localDateOf(new Date(), ctx.tenant.timezone);
  const data = await withCtxDb(ctx, async (tx) => {
    const period = await payPeriodFor(tx, date);
    if (!period) return null;
    return {
      result: await loadPayPeriod(tx, period),
      prev: await payPeriodFor(tx, addDays(period.start, -1)),
      next: await payPeriodFor(tx, period.endExclusive),
    };
  });

  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Pay period</h1>
        <Card>
          <p>No pay rules are approved for {day(date)} yet, so there is no pay period to show.</p>
          {check(ctx, 'pay.manage').allowed && <p className="mt-2"><Link className="underline" href="/admin/pay">Set up pay rules</Link></p>}
        </Card>
      </div>
    );
  }
  const { result, prev, next } = data;
  const last = addDays(result.period.endExclusive, -1);
  const totalHours = result.rows.reduce((s, r) => s + (r.result?.totalHours ?? 0), 0);
  const totalAmount = result.rows.every((r) => r.result === null || r.result.totalAmount !== null)
    ? result.rows.reduce((s, r) => s + (r.result?.totalAmount ?? 0), 0)
    : null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Pay period</h1>
      <p className="text-lg">{day(result.period.start)} – {day(last)}</p>
      <div className="flex flex-wrap gap-3">
        {prev && <Link href={`/pay?start=${prev.start}`} className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm">Previous period</Link>}
        {next && <Link href={`/pay?start=${next.start}`} className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm">Next period</Link>}
        <a href={`/pay/export?start=${result.period.start}`} className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm">Download CSV</a>
      </div>
      <p className="text-sm text-muted">
        {result.rows.length} members · {hrs(totalHours)} · {usd(totalAmount)} total. This is a preview from scheduled shifts and approved leave;
        it is not a timesheet.
      </p>

      <ul aria-label="Pay by member" className="space-y-3">
        {result.rows.map((m) => (
          <li key={m.memberId} className="rounded-lg border border-line bg-surface p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">{m.name}</span>
              {m.result && (
                <span>
                  <span className="mr-3">{hrs(m.result.totalHours)}</span>
                  <strong>{usd(m.result.totalAmount)}</strong>
                </span>
              )}
            </div>
            {m.problem && <p className="text-sm text-danger">{m.problem}</p>}
            {m.result && m.rate === null && <p className="text-sm text-muted">No hourly rate on file for this period, so no dollar amounts.</p>}
            {m.notes.map((n) => <p key={n} className="text-sm text-muted">{n}</p>)}
            {m.result && m.result.lines.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm underline">Show lines</summary>
                <ul className="mt-2 space-y-2 text-sm">
                  {m.result.lines.map((l, i) => (
                    <li key={`${l.code}-${i}`}>
                      <span className="font-medium">{l.code}</span> · {l.multiplier}× · {hrs(l.hours)} · {usd(l.amount)}
                      {l.compensated && ' · taken as comp time'}
                      {l.explain.map((e) => <span key={e.message} className="block text-muted">{e.message}</span>)}
                    </li>
                  ))}
                </ul>
                {m.result.comp.hours > 0 && <p className="mt-2 text-sm">Comp time credited: {hrs(m.result.comp.hours)}</p>}
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
