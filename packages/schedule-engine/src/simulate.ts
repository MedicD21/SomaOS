import type { AccrualFacts, AccrualPolicy, Period } from './accrual';
import { accrualPeriods, earnForPeriod, yearEndCarryover } from './accrual';
import type { ShiftPattern } from './pattern';
import { expandPattern } from './pattern';
import type { LeaveSegment, PayResult, PayRules, WorkSegment, WorkType } from './pay';
import { computePay } from './pay';
import type { IsoDate } from './time';
import { addDays } from './time';

/** What-if runners: thin, pure wrappers on the real engines. They never read or write anything. */

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Pay for made-up shifts: `count` shifts of `hours` for each entry, one per day from `start`, in order.
 * Use it to see what a rule set does before any real shifts exist.
 */
export function samplePay(
  rules: PayRules,
  input: { hourlyRate: number | null; start: IsoDate; shifts: { type: WorkType; hours: number; count: number }[]; prefersComp?: boolean },
): PayResult {
  const segments: WorkSegment[] = [];
  let day = input.start;
  for (const s of input.shifts) {
    for (let i = 0; i < s.count; i++) {
      segments.push({ id: `sample:${segments.length}`.padEnd(20, '0'), date: day, hours: s.hours, type: s.type });
      day = addDays(day, 1);
    }
  }
  const leave: LeaveSegment[] = [];
  return computePay({
    rules,
    hourlyRate: input.hourlyRate,
    prefersComp: input.prefersComp ?? false,
    segments,
    leave,
    period: { start: input.start, endExclusive: day },
  });
}

export type AccrualProjectionRow = {
  period: Period;
  hours: number;
  /** Hours forfeited at the carryover reset that happened just before this period. */
  expired: number;
  balanceAfter: number;
  capped: boolean;
  explain: string[];
};

/** The next `count` accrual periods from the one containing `from`, with a running balance. */
export function projectAccrual(
  policy: AccrualPolicy,
  facts: AccrualFacts,
  from: IsoDate,
  count: number,
  opts: { hoursWorkedPerPeriod?: number } = {},
): AccrualProjectionRow[] {
  const horizon = addDays(from, (policy.period.kind === 'monthly' ? 31 : policy.period.days) * (count + 1));
  const periods = accrualPeriods(policy.period, from, horizon).slice(0, count);
  const rows: AccrualProjectionRow[] = [];
  let balance = facts.balance;
  periods.forEach((period, i) => {
    let expired = 0;
    const prev = periods[i - 1];
    const explain: string[] = [];
    if (prev && policy.carryover.resetOn) {
      for (let y = Number(prev.start.slice(0, 4)); y <= Number(period.start.slice(0, 4)); y++) {
        const reset = `${y}-${policy.carryover.resetOn}`;
        if (prev.start < reset && reset <= period.start) {
          const r = yearEndCarryover(policy, balance);
          expired += r.expired;
          balance = r.carried;
          explain.push(...r.explain.map((e) => e.message));
        }
      }
    }
    const e = earnForPeriod(
      policy,
      { ...facts, balance, hoursWorked: opts.hoursWorkedPerPeriod ?? facts.hoursWorked },
      period,
    );
    balance = round2(balance + e.hours);
    explain.push(...e.explain.map((x) => x.message));
    rows.push({
      period,
      hours: e.hours,
      expired: round2(expired),
      balanceAfter: balance,
      capped: e.explain.some((x) => x.rule === 'accrual.cap'),
      explain,
    });
  });
  return rows;
}

export type PatternComparison = {
  approved: IsoDate[];
  draft: IsoDate[];
  added: IsoDate[];
  removed: IsoDate[];
  approvedHours: number;
  draftHours: number;
  warnings: string[];
};

function datesOf(p: ShiftPattern | null, platoon: string, from: IsoDate, to: IsoDate, tz: string, label: string, warnings: string[]) {
  if (!p) return { dates: [] as IsoDate[], hours: 0 };
  if (p.platoons[platoon] === undefined) {
    warnings.push(`The ${label} has no offset for shift "${platoon}".`);
    return { dates: [] as IsoDate[], hours: 0 };
  }
  const shifts = expandPattern(p, platoon, from, to, tz);
  return { dates: shifts.map((s) => s.date), hours: round2(shifts.reduce((s, x) => s + x.hours, 0)) };
}

/** On-duty dates for one shift under the approved pattern and the draft, and exactly which dates change. */
export function comparePatterns(
  approved: ShiftPattern | null,
  draft: ShiftPattern,
  platoon: string,
  from: IsoDate,
  toExclusive: IsoDate,
  tz: string,
): PatternComparison {
  const warnings: string[] = [];
  const a = datesOf(approved, platoon, from, toExclusive, tz, 'approved pattern', warnings);
  const d = datesOf(draft, platoon, from, toExclusive, tz, 'draft', warnings);
  const aSet = new Set(a.dates);
  const dSet = new Set(d.dates);
  return {
    approved: a.dates,
    draft: d.dates,
    added: d.dates.filter((x) => !aSet.has(x)),
    removed: a.dates.filter((x) => !dSet.has(x)),
    approvedHours: a.hours,
    draftHours: d.hours,
    warnings,
  };
}
