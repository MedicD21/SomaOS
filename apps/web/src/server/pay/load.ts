import 'server-only';
import {
  accrualPeriods, addDays, computePay, WORK_TYPES, workPeriodOf,
  type IsoDate, type LeaveSegment, type PayResult, type PayRules, type WorkSegment, type WorkType,
} from '@soma/schedule-engine';
import { payRulesSchema } from '@soma/validators';
import type { Tx } from '@/server/db';
import { ActionError } from '@/server/errors';
import { approvedOn } from '@/server/versioned-config';
import { RULES_KIND } from './rules';

export type Period = { start: IsoDate; endExclusive: IsoDate };

export type MemberPayRow = {
  memberId: string;
  name: string;
  employeeNumber: string | null;
  groupKey: string;
  rate: number | null;
  result: PayResult | null;
  /** Why there is no result (no approved rules, invalid rules). */
  problem: string | null;
  /** Things worth a look that did not stop the calculation. */
  notes: string[];
};

export type ClosedInfo = { id: string; closedAt: string; closedBy: string | null };

export type PayPeriodResult = {
  period: Period;
  rows: MemberPayRow[];
  /** Set when the period is closed: the rows are the frozen snapshot, not a recalculation. */
  closed: ClosedInfo | null;
};

/** The pay period containing `date` under the group's approved rules, or null when none are approved. */
export async function payPeriodFor(tx: Tx, date: IsoDate, groupKey = 'default'): Promise<Period | null> {
  const v = await approvedOn<PayRules>(tx, RULES_KIND, groupKey, date);
  if (!v) return null;
  return accrualPeriods(v.payload.payPeriod, date, addDays(date, 1))[0] ?? null;
}

type ShiftRow = {
  member_id: string;
  id: string;
  type: string;
  status: 'scheduled' | 'cancelled';
  date: string;
  hours: number;
  leave_key: string | null;
  counts_as_worked: boolean | null;
};

/**
 * A pay period as payroll sees it: the frozen snapshot when the period is closed (so later changes to
 * rules, rates or the roster cannot move closed numbers), otherwise a fresh calculation.
 */
export async function loadPayPeriod(tx: Tx, period: Period): Promise<PayPeriodResult> {
  const [can] = await tx<{ ok: boolean }[]>`select app.can_view_pay() as ok`;
  if (!can?.ok) throw new ActionError('Not allowed: pay.view required.');
  const [closed] = await tx<{ id: string; snapshot: PayPeriodResult; closed_at: string; closed_by_name: string | null }[]>`
    select c.id, c.snapshot, c.closed_at::text, (select m.last_name || ', ' || m.first_name from members m where m.user_id = c.closed_by and m.tenant_id = c.tenant_id) as closed_by_name
    from pay_period_closes c
    where c.status = 'closed' and c.period_start = ${period.start}::date and c.period_end = ${period.endExclusive}::date`;
  if (closed) {
    return { period, rows: closed.snapshot.rows, closed: { id: closed.id, closedAt: closed.closed_at, closedBy: closed.closed_by_name } };
  }
  return calculatePayPeriod(tx, period);
}

/**
 * Hours and dollars by pay code for every member in one pay period, from scheduled shifts, recorded
 * time entries and approved leave, using the pay rules approved for each member's group on the period's first day.
 * Runs as the signed-in user (RLS applies) and needs department-wide pay.view. Rules take effect at
 * the start of the pay period and a member's rate is the one in force on that day.
 */
export async function calculatePayPeriod(
  tx: Tx,
  period: Period,
  opts: {
    /** Use these rules for a group instead of the approved ones (simulation). */
    rulesOverride?: ReadonlyMap<string, PayRules>;
    /** Only this employee group's members. */
    groupKey?: string;
    /** Only this member. */
    memberId?: string;
  } = {},
): Promise<PayPeriodResult> {
  const [can] = await tx<{ ok: boolean }[]>`select app.can_view_pay() as ok`;
  if (!can?.ok) throw new ActionError('Not allowed: pay.view required.');

  const members = await tx<{ id: string; first_name: string; last_name: string; employee_number: string | null; group_key: string; custom: Record<string, unknown> | null }[]>`
    select m.id, m.first_name, m.last_name, m.employee_number, coalesce(g.key, 'default') as group_key, m.custom
    from members m left join employee_groups g on g.id = m.employee_group_id
    where m.tenant_id = app.tenant_id() and (m.status <> 'separated' or m.separated_on >= ${period.start}::date)
      ${opts.groupKey ? tx`and coalesce(g.key, 'default') = ${opts.groupKey}` : tx``}
      ${opts.memberId ? tx`and m.id = ${opts.memberId}` : tx``}
    order by m.last_name, m.first_name`;

  const rulesByGroup = new Map<string, { rules: PayRules } | { problem: string }>();
  for (const key of new Set(members.map((m) => m.group_key))) {
    const override = opts.rulesOverride?.get(key);
    const v = override ? { payload: override as unknown } : await approvedOn<unknown>(tx, RULES_KIND, key, period.start);
    if (!v) {
      rulesByGroup.set(key, { problem: `No approved pay rules for group "${key}" on ${period.start}.` });
      continue;
    }
    const parsed = payRulesSchema.safeParse(v.payload);
    rulesByGroup.set(key, parsed.success
      ? { rules: parsed.data as PayRules }
      : { problem: `The pay rules for group "${key}" are invalid (${parsed.error.issues[0]?.path.join('.') ?? 'rules'}): ${parsed.error.issues[0]?.message}.` });
  }

  const usable = [...rulesByGroup.values()].flatMap((v) => ('rules' in v ? [v.rules] : []));
  const loadFrom = usable.length ? usable.map((r) => workPeriodOf(r.workPeriod, period.start).start).sort()[0]! : period.start;

  const ids = members.map((m) => m.id);
  const shifts = usable.length && ids.length
    ? await tx<ShiftRow[]>`
        select a.member_id, a.id, a.type, a.status,
               (lower(a.during) at time zone z.tz)::date::text as date,
               round(extract(epoch from ((upper(a.during) at time zone z.tz) - (lower(a.during) at time zone z.tz))) / 3600.0, 2)::float8 as hours,
               lt.key as leave_key, lt.counts_as_worked
        from shift_assignments a
        cross join lateral (
          select coalesce(ou.timezone, t.timezone) as tz
          from tenants t left join seats s on s.id = a.seat_id left join org_units ou on ou.id = s.org_unit_id
          where t.id = a.tenant_id) z
        left join leave_requests lr on lr.id = a.leave_request_id
        left join leave_types lt on lt.id = lr.leave_type_id
        where a.member_id = any(${ids}) and a.type <> 'kelly'
          and (a.status = 'scheduled' or (a.status = 'cancelled' and a.leave_request_id is not null and lr.status = 'approved'))
          and (lower(a.during) at time zone z.tz)::date >= ${loadFrom}::date
          and (lower(a.during) at time zone z.tz)::date < ${period.endExclusive}::date`
    : [];

  const timeEntries = usable.length && ids.length
    ? await tx<{ member_id: string; id: string; type: string; date: string; hours: number }[]>`
        select member_id, id, type, work_date::text as date, hours::float8 as hours
        from time_entries
        where status = 'active' and member_id = any(${ids})
          and work_date >= ${loadFrom}::date and work_date < ${period.endExclusive}::date`
    : [];

  const rates = new Map(
    (await tx<{ member_id: string; rate: number }[]>`
      select member_id, hourly_rate::float8 as rate from member_pay_rates
      where member_id = any(${ids}) and effective @> ${period.start}::date`).map((r) => [r.member_id, r.rate]),
  );
  const payCodes = new Map(
    (await tx<{ key: string; multiplier: number; archived: boolean }[]>`
      select key, multiplier::float8 as multiplier, archived_at is not null as archived from pay_codes`).map((c) => [c.key, c]),
  );

  const byMember = new Map<string, ShiftRow[]>();
  for (const s of shifts) (byMember.get(s.member_id) ?? byMember.set(s.member_id, []).get(s.member_id)!).push(s);

  const rows: MemberPayRow[] = members.map((m) => {
    const base = { memberId: m.id, name: `${m.last_name}, ${m.first_name}`, employeeNumber: m.employee_number, groupKey: m.group_key, rate: rates.get(m.id) ?? null, notes: [] as string[] };
    const found = rulesByGroup.get(m.group_key)!;
    if ('problem' in found) return { ...base, result: null, problem: found.problem };

    const segments: WorkSegment[] = [];
    const leave: LeaveSegment[] = [];
    for (const s of byMember.get(m.id) ?? []) {
      if (s.status === 'scheduled') {
        if ((WORK_TYPES as readonly string[]).includes(s.type)) segments.push({ id: s.id, date: s.date, hours: s.hours, type: s.type as WorkType });
      } else if (s.leave_key) {
        const code = payCodes.get(s.leave_key);
        if (!code || code.archived) {
          base.notes.push(`Leave type "${s.leave_key}" has no pay code, so ${s.hours} h on ${s.date} are not paid.`);
        } else if (code.multiplier > 0) {
          leave.push({ id: s.id, date: s.date, hours: s.hours, code: s.leave_key, countsAsWorked: s.counts_as_worked === true });
        }
      }
    }
    for (const e of timeEntries) {
      if (e.member_id === m.id && (WORK_TYPES as readonly string[]).includes(e.type)) {
        segments.push({ id: `time:${e.id}`, date: e.date, hours: e.hours, type: e.type as WorkType });
      }
    }
    const result = computePay({
      rules: found.rules,
      hourlyRate: base.rate,
      prefersComp: m.custom?.prefers_comp_time === true,
      segments,
      leave,
      period,
    });
    return { ...base, result, problem: null };
  });

  return { period, rows, closed: null };
}
