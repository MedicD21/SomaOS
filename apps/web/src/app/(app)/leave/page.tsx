import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { dateRange, loadMyLeave } from '@/server/leave/load';
import { CancelLeaveForm, RequestLeaveForm } from './forms';

const STATUS: Record<string, string> = { pending: 'Pending', approved: 'Approved', denied: 'Denied', cancelled: 'Cancelled' };

export default async function MyLeavePage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('leave')) return <Forbidden reason="leave is not enabled for this department" />;
  if (!hasAny(ctx, 'leave.request')) return <Forbidden reason="no leave request permission" />;
  if (!ctx.memberId) {
    return (
      <Card>
        <h1 className="mb-2 text-xl font-bold">My leave</h1>
        <p>Your account is not linked to a member record in this department yet.</p>
      </Card>
    );
  }
  const { balances, types, requests } = await withCtxDb(ctx, (tx) => loadMyLeave(tx));
  const typeOptions = types.map((t) => ({
    id: t.id,
    label: t.label,
    hint: [t.bank_label ? `Uses ${t.bank_label}` : 'No balance', t.lead_time_days > 0 ? `${t.lead_time_days} days notice` : null, t.requires_documentation ? 'documentation required' : null]
      .filter(Boolean)
      .join(' · '),
  }));
  const hours = (n: number) => `${Math.round(n * 100) / 100} h`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My leave</h1>

      <section aria-labelledby="bal-heading">
        <h2 id="bal-heading" className="mb-3 text-lg font-semibold">Balances</h2>
        {balances.length === 0 ? (
          <p className="text-muted">Your department has not set up leave balances yet.</p>
        ) : (
          <ul aria-label="Leave balances" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {balances.map((b) => (
              <li key={b.bank_id} className="rounded-lg border border-line bg-surface p-4">
                <span className="block text-sm text-muted">{b.label}</span>
                <span className="block text-2xl font-bold">{hours(b.hours)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card title="Request leave">
        {types.length === 0 ? <p>No leave types are set up yet.</p> : <RequestLeaveForm types={typeOptions} />}
      </Card>

      <section aria-labelledby="req-heading">
        <h2 id="req-heading" className="mb-3 text-lg font-semibold">My requests</h2>
        {requests.length === 0 ? (
          <p className="text-muted">You have not requested any leave.</p>
        ) : (
          <ul aria-label="My leave requests" className="space-y-3">
            {requests.map((r) => (
              <li key={r.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{r.type}</span>
                  <span className="text-sm font-medium">{STATUS[r.status]}</span>
                </div>
                <p className="text-sm">{dateRange(r.start_date, r.end_date)} · {hours(r.hours)}</p>
                {r.reason && <p className="text-sm text-muted">Reason: {r.reason}</p>}
                {r.decision_note && <p className="text-sm text-muted">Note: {r.decision_note}</p>}
                {(r.status === 'pending' || r.status === 'approved') && (
                  <CancelLeaveForm id={r.id} label={`${r.type} ${dateRange(r.start_date, r.end_date)}`} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
