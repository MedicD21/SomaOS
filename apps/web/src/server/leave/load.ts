import 'server-only';
import type { Tx } from '@/server/db';

export type Balance = { bank_id: string; label: string; hours: number };
export type LeaveTypeOption = { id: string; label: string; bank_label: string | null; requires_documentation: boolean; lead_time_days: number };
export type MyRequest = {
  id: string;
  type: string;
  start_date: string;
  end_date: string;
  hours: number;
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
  reason: string | null;
  decision_note: string | null;
};
export type PendingRequest = {
  request_id: string;
  member_name: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  hours: number;
  reason: string | null;
  created_at: Date;
};

export async function loadMyLeave(tx: Tx): Promise<{ balances: Balance[]; types: LeaveTypeOption[]; requests: MyRequest[] }> {
  const balances = await tx<Balance[]>`
    select b.id as bank_id, b.label, coalesce(lb.hours, 0)::float8 as hours
    from leave_banks b
    left join leave_balances lb on lb.bank_id = b.id and lb.member_id = app.my_member_id()
    where b.archived_at is null order by b.label`;
  const types = await tx<LeaveTypeOption[]>`
    select t.id, t.label, b.label as bank_label, t.requires_documentation, t.lead_time_days
    from leave_types t left join leave_banks b on b.id = t.bank_id
    where t.archived_at is null and (t.audience = 'member' or app.can_use_officer_leave())
    order by t.sort, t.label`;
  const requests = await tx<MyRequest[]>`
    select r.id, t.label as type, r.start_date::text, r.end_date::text, r.hours::float8 as hours, r.status, r.reason, r.decision_note
    from leave_requests r join leave_types t on t.id = r.leave_type_id
    where r.member_id = app.my_member_id() order by r.start_date desc, r.created_at desc limit 50`;
  return { balances: [...balances], types: [...types], requests: [...requests] };
}

export async function loadPending(tx: Tx): Promise<PendingRequest[]> {
  const rows = await tx<PendingRequest[]>`
    select request_id, member_name, leave_type, start_date::text, end_date::text, hours::float8 as hours, reason, created_at
    from app.leave_requests_in_scope('pending')`;
  return [...rows];
}

export type LimitDay = { day: string; label: string; max_concurrent: number; on_leave: number; over: boolean };

/** Days where approving this request would reach or exceed a leave limit (empty when no limit applies). */
export async function loadLimitStatus(tx: Tx, requestId: string): Promise<LimitDay[]> {
  const rows = await tx<LimitDay[]>`select day::text, label, max_concurrent, on_leave, over from app.leave_request_limits(${requestId})`;
  return [...rows];
}

/** "Dec 10" or "Dec 10 – Dec 12, 2026". Dates are plain calendar days, shown without time-zone shifts. */
export function dateRange(start: string, end: string): string {
  const f = (d: string, withYear: boolean) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  return start === end ? f(start, true) : `${f(start, false)} – ${f(end, true)}`;
}
