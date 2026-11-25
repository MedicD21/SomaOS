import 'server-only';
import {
  accrualPeriods, addDays, comparePatterns, localDateOf, projectAccrual, samplePay, workPeriodOf,
  type AccrualFacts, type AccrualPolicy, type PayResult, type PayRules, type ShiftPattern, type WorkType,
} from '@soma/schedule-engine';
import { accrualPolicySchema, payRulesSchema, shiftPatternSchema } from '@soma/validators';
import type { AccrualColumn, AccrualSim, PaySim, PaySimColumn, PatternSim } from '@/components/rule-builder/sim-types';
import type { Tx } from '@/server/db';
import { ActionError } from '@/server/errors';
import { calculatePayPeriod } from '@/server/pay/load';
import { RULES_KIND } from '@/server/pay/rules';
import { approvedOn } from '@/server/versioned-config';

/**
 * Read-only what-if runs: the draft and the approved rules go through the same engines the real pages
 * and workers use, side by side. Nothing here writes anything.
 */

const MAX_ROWS = 200;
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

function column(r: PayResult | null, problem: string | null): PaySimColumn | null {
  if (!r) return problem ? { hours: 0, amount: null, compHours: 0, lines: [], problem } : null;
  return {
    hours: r.totalHours,
    amount: r.totalAmount,
    compHours: r.comp.hours,
    lines: r.lines.map((l) => ({ code: l.code, multiplier: l.multiplier, hours: l.hours, amount: l.amount })),
    problem: null,
  };
}

const sumAmount = (cols: (PaySimColumn | null)[]): number | null => {
  const live = cols.filter((c): c is PaySimColumn => c !== null && c.problem === null);
  return live.length > 0 && live.every((c) => c.amount !== null) ? round2(live.reduce((s, c) => s + (c.amount ?? 0), 0)) : null;
};
const sumHours = (cols: (PaySimColumn | null)[]): number => round2(cols.reduce((s, c) => s + (c?.hours ?? 0), 0));

export type PaySimInput =
  | { mode: 'period'; groupKey: string; draft: PayRules; today: string; date: string | null; memberId: string | null }
  | { mode: 'sample'; groupKey: string; draft: PayRules; today: string; hourlyRate: number | null; shifts: { type: WorkType; hours: number; count: number }[] };

export async function simulatePay(tx: Tx, input: PaySimInput): Promise<{ sim: PaySim; summary: string }> {
  const approvedRow = await approvedOn<unknown>(tx, RULES_KIND, input.groupKey, input.today);
  const approvedParsed = approvedRow ? payRulesSchema.safeParse(approvedRow.payload) : null;
  const approved = approvedParsed?.success ? (approvedParsed.data as PayRules) : null;
  const noApproved = approvedRow ? 'The approved rules are not valid.' : `No approved pay rules for "${input.groupKey}" yet.`;
  const notes = ['A pay period uses the rules in force on its first day.'];

  if (input.mode === 'sample') {
    // Start at the beginning of a work period so the made-up shifts never straddle a threshold reset.
    const start = workPeriodOf(input.draft.workPeriod, input.today).start;
    const spec = { hourlyRate: input.hourlyRate, start, shifts: input.shifts };
    const a = approved ? samplePay(approved, spec) : null;
    const d = samplePay(input.draft, spec);
    const rows = [{ id: 'sample', name: 'Sample member', approved: column(a, noApproved), draft: column(d, null) }];
    const count = input.shifts.reduce((s, x) => s + x.count, 0);
    notes.push('Made-up shifts, one per day in the order listed. Not real people or hours.');
    return {
      sim: { kind: 'pay', mode: 'sample', heading: 'Sample shifts', rows, totals: totals(rows), notes },
      summary: `sample of ${count} shift${count === 1 ? '' : 's'} for group ${input.groupKey}`,
    };
  }

  const day = input.date ?? input.today;
  const period = accrualPeriods(input.draft.payPeriod, day, addDays(day, 1))[0];
  if (!period) throw new ActionError('There is no pay period for that date.');
  const opts = { groupKey: input.groupKey, ...(input.memberId ? { memberId: input.memberId } : {}) };
  const approvedRes = await calculatePayPeriod(tx, { start: period.start, endExclusive: period.endExclusive }, opts);
  const draftRes = await calculatePayPeriod(tx, { start: period.start, endExclusive: period.endExclusive }, { ...opts, rulesOverride: new Map([[input.groupKey, input.draft]]) });
  const draftById = new Map(draftRes.rows.map((r) => [r.memberId, r]));
  const rows = approvedRes.rows.slice(0, MAX_ROWS).map((r) => {
    const d = draftById.get(r.memberId) ?? null;
    return {
      id: r.memberId,
      name: r.name,
      approved: column(r.result, r.problem),
      draft: column(d?.result ?? null, d?.problem ?? null),
    };
  });
  if (approvedRes.rows.length > MAX_ROWS) notes.push(`Showing the first ${MAX_ROWS} of ${approvedRes.rows.length} members.`);
  if (rows.length === 0) notes.push('No members are in this group for that period.');
  notes.push('Uses scheduled shifts, recorded time entries and approved leave as they stand now. A closed period shows a fresh calculation here, not the frozen snapshot.');
  return {
    sim: { kind: 'pay', mode: 'period', heading: `Pay period ${period.start} to ${addDays(period.endExclusive, -1)}`, rows, totals: totals(rows), notes },
    summary: `pay period ${period.start} for group ${input.groupKey}${input.memberId ? ' (one member)' : ''}`,
  };
}

function totals(rows: { approved: PaySimColumn | null; draft: PaySimColumn | null }[]): PaySim['totals'] {
  const a = rows.map((r) => r.approved);
  const d = rows.map((r) => r.draft);
  return { approvedHours: sumHours(a), draftHours: sumHours(d), approvedAmount: sumAmount(a), draftAmount: sumAmount(d) };
}

export type AccrualSimInput = {
  bankKey: string;
  draft: AccrualPolicy;
  today: string;
  from: string | null;
  memberId: string | null;
  sample: { hireDate: string | null; employmentType: string; balance: number } | null;
  hoursWorkedPerPeriod: number;
};

const PERIODS = 12;

export async function simulateAccrual(tx: Tx, input: AccrualSimInput): Promise<{ sim: AccrualSim; summary: string }> {
  const approvedRow = await approvedOn<unknown>(tx, 'leave.accrual', input.bankKey, input.today);
  const parsed = approvedRow ? accrualPolicySchema.safeParse(approvedRow.payload) : null;
  const approved = parsed?.success ? (parsed.data as AccrualPolicy) : null;
  const notes: string[] = [];
  if (!approved) notes.push(approvedRow ? 'The approved policy is not valid.' : 'No policy is approved for this bank yet, so only the draft is projected.');

  let facts: AccrualFacts;
  let who: string;
  if (input.memberId) {
    const [m] = await tx<{ hire_date: string | null; employment_type: string; separated_on: string | null; name: string }[]>`
      select hire_date::text as hire_date, employment_type, separated_on::text as separated_on, last_name || ', ' || first_name as name
      from members where id = ${input.memberId} and tenant_id = app.tenant_id()`;
    if (!m) throw new ActionError('That member was not found.');
    const [bal] = await tx<{ hours: number }[]>`
      select coalesce(sum(l.hours), 0)::float8 as hours from leave_ledger l join leave_banks b on b.id = l.bank_id
      where l.member_id = ${input.memberId} and b.key = ${input.bankKey}`;
    facts = { hireDate: m.hire_date, employmentType: m.employment_type, hoursWorked: input.hoursWorkedPerPeriod, balance: bal?.hours ?? 0, separatedOn: m.separated_on };
    who = m.name;
    notes.push(`Starts from ${m.name}'s real hire date and current balance of ${round2(facts.balance)} h.`);
  } else {
    const s = input.sample ?? { hireDate: null, employmentType: 'career_full_time', balance: 0 };
    facts = { hireDate: s.hireDate, employmentType: s.employmentType, hoursWorked: input.hoursWorkedPerPeriod, balance: s.balance, separatedOn: null };
    who = 'Sample member';
    notes.push('Sample facts you entered, not a real person.');
  }
  if (input.hoursWorkedPerPeriod > 0) notes.push(`Assumes ${input.hoursWorkedPerPeriod} h worked in every period (only matters for per-hours-worked tiers).`);

  const from = input.from ?? input.today;
  const opts = { hoursWorkedPerPeriod: input.hoursWorkedPerPeriod };
  const col = (r: { hours: number; balanceAfter: number; expired: number; capped: boolean }): AccrualColumn => ({ hours: r.hours, balanceAfter: r.balanceAfter, expired: r.expired, capped: r.capped });
  const dRows = projectAccrual(input.draft, facts, from, PERIODS, opts);
  const aRows = approved ? projectAccrual(approved, facts, from, PERIODS, opts) : [];
  const aBy = new Map(aRows.map((r) => [r.period.start, r]));
  const dBy = new Map(dRows.map((r) => [r.period.start, r]));
  const starts = [...new Set([...aBy.keys(), ...dBy.keys()])].sort();
  const rows = starts.map((s) => {
    const a = aBy.get(s);
    const d = dBy.get(s);
    return { period: s, approved: a ? col(a) : null, draft: d ? col(d) : null, explain: d?.explain ?? a?.explain ?? [] };
  });
  return {
    sim: { kind: 'accrual', heading: `${who}: next ${PERIODS} periods from ${from}`, rows, notes },
    summary: `accrual projection from ${from} for bank ${input.bankKey}`,
  };
}

export type PatternSimInput = { draft: ShiftPattern; today: string; tz: string; shiftKey: string; from: string | null; weeks: number };

export async function simulatePattern(tx: Tx, input: PatternSimInput): Promise<{ sim: PatternSim; summary: string }> {
  const approvedRow = await approvedOn<unknown>(tx, 'schedule.pattern', 'default', input.today);
  const parsed = approvedRow ? shiftPatternSchema.safeParse(approvedRow.payload) : null;
  const approved = parsed?.success ? (parsed.data as ShiftPattern) : null;
  const from = input.from ?? input.today;
  const to = addDays(from, input.weeks * 7);
  const cmp = comparePatterns(approved, input.draft, input.shiftKey, from, to, input.tz);
  const aSet = new Set(cmp.approved);
  const dSet = new Set(cmp.draft);
  const days: PatternSim['days'] = [];
  for (let d = from; d < to; d = addDays(d, 1)) days.push({ date: d, approved: aSet.has(d), draft: dSet.has(d) });

  const tomorrow = addDays(input.today, 1);
  const [rep] = await tx<{ n: number }[]>`
    select count(*)::int as n from shift_assignments a
    where a.tenant_id = app.tenant_id() and a.source = 'generated' and a.status = 'scheduled' and lower(a.during) > now()
      and (lower(a.during) at time zone coalesce(
            (select ou.timezone from seats s join org_units ou on ou.id = s.org_unit_id where s.id = a.seat_id),
            (select t.timezone from tenants t where t.id = a.tenant_id)))::date >= ${tomorrow}::date`;
  const notes = [...cmp.warnings];
  if (!approved) notes.push('No pattern is approved yet, so every on-duty day shown is new.');
  return {
    sim: {
      kind: 'pattern',
      heading: `Shift "${input.shiftKey}": ${input.weeks} weeks from ${from}`,
      days,
      added: cmp.added,
      removed: cmp.removed,
      approvedHours: cmp.approvedHours,
      draftHours: cmp.draftHours,
      replaced: rep?.n ?? 0,
      notes,
    },
    summary: `pattern comparison for shift ${input.shiftKey} from ${from}`,
  };
}

/** Local today for the department (the simulation's reference date). */
export const todayIn = (tz: string): string => localDateOf(new Date(), tz);
