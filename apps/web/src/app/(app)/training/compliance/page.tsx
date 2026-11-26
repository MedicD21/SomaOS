import Link from 'next/link';
import { Forbidden } from '@/components/forbidden';
import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { loadCompliance } from '@/server/training/compliance';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['overdue', 'due_soon', 'on_track', 'met'] as const;
const LABEL: Record<string, string> = { overdue: 'Overdue', due_soon: 'Due soon', on_track: 'On track', met: 'Met' };

export default async function CompliancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('training')) return <Forbidden reason="training is not enabled for this department" />;
  if (!hasAny(ctx, 'training.compliance.view')) return <Forbidden reason="training.compliance.view is required" />;

  const unitId = sp.unit && UUID.test(sp.unit) ? sp.unit : null;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? '') ? sp.status! : null;
  const data = await withCtxDb(ctx, async (tx) => {
    const { today, rows } = await loadCompliance(tx, ctx.tenant.timezone, unitId);
    const units = await tx<{ id: string; name: string }[]>`select id, name from org_units order by path`;
    return { today, rows, units: [...units] };
  });
  const counts = Object.fromEntries(STATUSES.map((s) => [s, data.rows.filter((r) => r.status === s).length]));
  const shown = status ? data.rows.filter((r) => r.status === status) : data.rows;
  const q = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { unit: unitId, status, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : '';
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Training compliance</h1>
      <p className="text-muted">Required hours by member, as of {data.today}. You see the members in your scope.</p>

      <form method="get" aria-label="Filter compliance" className="flex flex-wrap items-end gap-3">
        <label className="block text-sm font-medium">
          Station
          <select name="unit" defaultValue={unitId ?? ''} className="mt-1 block min-h-11 rounded-md border border-line bg-surface px-3 py-2 text-fg">
            <option value="">All in my scope</option>
            {data.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        {status && <input type="hidden" name="status" value={status} />}
        <button type="submit" className="min-h-11 rounded-md border border-line px-4 text-sm">Apply</button>
        <a href={`/training/compliance/export${q({})}`} className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm">Download CSV</a>
      </form>

      <nav aria-label="Status" className="flex flex-wrap gap-2">
        <Link href={`/training/compliance${q({ status: null })}`} className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm" aria-current={status ? undefined : 'page'}>All ({data.rows.length})</Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/training/compliance${q({ status: s })}`} className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm" aria-current={status === s ? 'page' : undefined}>
            {LABEL[s]} ({counts[s]})
          </Link>
        ))}
      </nav>

      {shown.length === 0 ? <p>Nothing to show.</p> : (
        <ul aria-label="Compliance" className="space-y-3">
          {shown.map((r) => (
            <li key={`${r.memberId}-${r.requirementId}`} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{r.memberName}</span>
                <span className={r.status === 'overdue' ? 'font-semibold text-danger' : 'text-sm'}>{LABEL[r.status]}</span>
              </div>
              <p className="text-sm">{r.requirementLabel} · {r.categoryLabel}</p>
              <p className="text-sm text-muted">{r.earned} of {r.required} h · {r.remaining > 0 ? `${r.remaining} h to go` : 'complete'} · {r.windowStart} to {r.windowEnd}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
