import { Forbidden } from '@/components/forbidden';
import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { dateRange, loadPending } from '@/server/leave/load';
import { ApproveForm, DenyForm } from './forms';

export default async function LeaveApprovalsPage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('leave')) return <Forbidden reason="leave is not enabled for this department" />;
  // Any scope opens the page; the database returns only requests the caller may actually decide.
  if (!hasAny(ctx, 'leave.approve')) return <Forbidden reason="no leave approval permission" />;
  const pending = await withCtxDb(ctx, (tx) => loadPending(tx));
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
            return (
              <li key={r.request_id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{r.member_name}</span>
                  <span className="text-sm">{r.leave_type}</span>
                </div>
                <p className="text-sm">{dateRange(r.start_date, r.end_date)} · {Math.round(r.hours * 100) / 100} h</p>
                {r.reason && <p className="text-sm text-muted">Reason: {r.reason}</p>}
                <div className="mt-3 space-y-3">
                  <ApproveForm id={r.request_id} label={label} />
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
