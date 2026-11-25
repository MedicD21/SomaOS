import { Forbidden } from '@/components/forbidden';
import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { dateRange, loadLimitStatus, loadPending, type LimitDay } from '@/server/leave/load';
import { ApproveForm, DenyForm } from './forms';

export default async function LeaveApprovalsPage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('leave')) return <Forbidden reason="leave is not enabled for this department" />;
  // Any scope opens the page; the database returns only requests the caller may actually decide.
  if (!hasAny(ctx, 'leave.approve')) return <Forbidden reason="no leave approval permission" />;
  const data = await withCtxDb(ctx, async (tx) => {
    const pending = await loadPending(tx);
    const limits: Record<string, LimitDay[]> = {};
    for (const r of pending) limits[r.request_id] = await loadLimitStatus(tx, r.request_id);
    return { pending, limits };
  });
  const { pending, limits } = data;
  const canOverride = hasAny(ctx, 'leave.manage');
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Leave approvals</h1>
      <p className="text-muted">Requests from members in your station and shift scope. Approving debits their balance and frees their scheduled shifts on the roster.</p>
      {pending.length === 0 ? (
        <p>No requests are waiting for you.</p>
      ) : (
        <ul aria-label="Requests waiting for approval" className="space-y-3">
          {pending.map((r) => {
            const label = `${r.member_name} ${dateRange(r.start_date, r.end_date)}`;
            const days = limits[r.request_id] ?? [];
            const over = days.filter((d) => d.over);
            return (
              <li key={r.request_id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{r.member_name}</span>
                  <span className="text-sm">{r.leave_type}</span>
                </div>
                <p className="text-sm">{dateRange(r.start_date, r.end_date)} · {Math.round(r.hours * 100) / 100} h</p>
                {r.reason && <p className="text-sm text-muted">Reason: {r.reason}</p>}
                {days.length > 0 && (
                  <div role="note" aria-label={`Leave limits for ${label}`} className="mt-2 rounded-md border border-line p-3 text-sm">
                    <p className="font-medium">{over.length > 0 ? 'Over a leave limit' : 'At a leave limit'}</p>
                    <ul className="list-disc pl-5">
                      {days.map((d) => (
                        <li key={`${d.day}-${d.label}`}>
                          {dateRange(d.day, d.day)} — {d.label}: {d.on_leave} of {d.max_concurrent} already on leave{d.over ? ' (approving goes over)' : ' (approving reaches the limit)'}
                        </li>
                      ))}
                    </ul>
                    {over.length > 0 && !canOverride && <p className="mt-1 text-muted">A leave manager must approve this request anyway, or you can deny it.</p>}
                  </div>
                )}
                <div className="mt-3 space-y-3">
                  <ApproveForm id={r.request_id} label={label} overridable={over.length > 0 && canOverride} />
                  <DenyForm id={r.request_id} label={label} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
