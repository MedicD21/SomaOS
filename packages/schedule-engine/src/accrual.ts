import { Temporal } from 'temporal-polyfill';
import type { Explain } from './explain';
import type { IsoDate } from './time';
import { addDays, daysBetween } from './time';

export type EarnRule =
  | { method: 'per_period'; hours: number }
  | { method: 'per_hours_worked'; perHours: number; earnHours: number }
  | { method: 'annual_front_load'; hours: number }
  | { method: 'manual' };

export type AccrualPolicy = {
  period: { kind: 'monthly' } | { kind: 'fixed_days'; days: number; anchor: IsoDate };
  /** At least one tier; the first has fromYears 0. The tier with the greatest fromYears ≤ years of service applies. */
  tiers: { fromYears: number; earn: EarnRule }[];
  /** Maximum balance; earning stops at the cap. null = no cap. */
  cap: number | null;
  /** No accrual until hireDate + N days. */
  waitingPeriodDays: number;
  /** Scale per_period earnings in the period containing the hire date by days employed. */
  prorateFirstPeriod: boolean;
  /** Multiplier by employment type (e.g. career_part_time: 0.5); absent = 1. */
  fractionByEmploymentType: Record<string, number>;
  negativeAllowed: boolean;
  /** At resetOn ('MM-DD', local) balance above max is forfeited. max null = carry everything. */
  carryover: { max: number | null; resetOn: string | null };
};

export type AccrualFacts = {
  hireDate: IsoDate | null;
  employmentType: string;
  hoursWorked: number;
  balance: number;
  separatedOn: IsoDate | null;
};

export type Period = { start: IsoDate; endExclusive: IsoDate };

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const fmt = (n: number): string => String(round2(n));

/** Whole years of service on `on` (0 before the first anniversary or before hire). */
export function yearsOfService(hire: IsoDate, on: IsoDate): number {
  const years = Temporal.PlainDate.from(hire).until(Temporal.PlainDate.from(on), { largestUnit: 'years' }).years;
  return Math.max(0, years);
}

/** Accrual periods overlapping [from, toExclusive). */
export function accrualPeriods(p: AccrualPolicy['period'], from: IsoDate, toExclusive: IsoDate): Period[] {
  const out: Period[] = [];
  if (p.kind === 'monthly') {
    let start = Temporal.PlainDate.from(from).with({ day: 1 });
    while (start.toString() < toExclusive) {
      const next = start.add({ months: 1 });
      out.push({ start: start.toString(), endExclusive: next.toString() });
      start = next;
    }
    return out;
  }
  const blocks = Math.floor(daysBetween(p.anchor, from) / p.days);
  let start = addDays(p.anchor, blocks * p.days);
  while (start < toExclusive) {
    const next = addDays(start, p.days);
    out.push({ start, endExclusive: next });
    start = next;
  }
  return out;
}

function containsJan1(period: Period): boolean {
  for (let y = Number(period.start.slice(0, 4)); y <= Number(period.endExclusive.slice(0, 4)); y++) {
    const jan1 = `${y}-01-01`;
    if (period.start <= jan1 && jan1 < period.endExclusive) return true;
  }
  return false;
}

export function earnForPeriod(
  policy: AccrualPolicy,
  facts: AccrualFacts,
  period: Period,
): { hours: number; explain: Explain[] } {
  const explain: Explain[] = [];
  const none = (rule: string, message: string) => ({ hours: 0, explain: [{ rule, message }] });

  if (facts.separatedOn && facts.separatedOn <= period.start) {
    return none('accrual.separated', `Separated on ${facts.separatedOn}; nothing accrues from ${period.start}.`);
  }
  if (facts.hireDate && facts.hireDate >= period.endExclusive) {
    return none('accrual.not_hired', `Hired ${facts.hireDate}, after this period.`);
  }
  if (facts.hireDate && policy.waitingPeriodDays > 0) {
    const eligible = addDays(facts.hireDate, policy.waitingPeriodDays);
    if (eligible >= period.endExclusive) {
      return none('accrual.waiting', `Waiting period of ${policy.waitingPeriodDays} days ends ${eligible}.`);
    }
  }

  const lastDay = addDays(period.endExclusive, -1);
  const years = facts.hireDate ? yearsOfService(facts.hireDate, lastDay) : 0;
  const tier = [...policy.tiers].sort((a, b) => b.fromYears - a.fromYears).find((t) => t.fromYears <= years) ?? policy.tiers[0]!;
  explain.push({
    rule: 'accrual.tier',
    message: `${years} year(s) of service: tier from ${tier.fromYears} year(s), ${tier.earn.method}.`,
    data: { years, fromYears: tier.fromYears },
  });

  const earn = tier.earn;
  let hours = 0;
  switch (earn.method) {
    case 'per_period':
      hours = earn.hours;
      break;
    case 'per_hours_worked':
      hours = (facts.hoursWorked / earn.perHours) * earn.earnHours;
      break;
    case 'annual_front_load':
      hours = containsJan1(period) ? earn.hours : 0;
      break;
    case 'manual':
      hours = 0;
      break;
  }

  const fraction = policy.fractionByEmploymentType[facts.employmentType] ?? 1;
  if (fraction !== 1) {
    hours *= fraction;
    explain.push({ rule: 'accrual.fraction', message: `${facts.employmentType} earns ${fraction} of the full amount.` });
  }

  if (
    policy.prorateFirstPeriod &&
    earn.method === 'per_period' &&
    facts.hireDate &&
    facts.hireDate > period.start &&
    facts.hireDate < period.endExclusive
  ) {
    const employed = daysBetween(facts.hireDate, period.endExclusive);
    const total = daysBetween(period.start, period.endExclusive);
    hours = (hours * employed) / total;
    explain.push({ rule: 'accrual.prorate', message: `Hired ${facts.hireDate}: ${employed} of ${total} days in the period.` });
  }

  if (policy.cap !== null && facts.balance + hours > policy.cap) {
    const room = Math.max(0, policy.cap - facts.balance);
    explain.push({ rule: 'accrual.cap', message: `Capped at ${policy.cap} h: only ${fmt(room)} h can be added to a balance of ${fmt(facts.balance)} h.` });
    hours = room;
  }

  return { hours: round2(hours), explain };
}

export function yearEndCarryover(
  policy: AccrualPolicy,
  balance: number,
): { carried: number; expired: number; explain: Explain[] } {
  const max = policy.carryover.max;
  if (max === null || balance <= max) {
    return { carried: balance, expired: 0, explain: [{ rule: 'carryover.all', message: `${fmt(balance)} h carries over.` }] };
  }
  const expired = round2(balance - max);
  return {
    carried: max,
    expired,
    explain: [{ rule: 'carryover.max', message: `Carryover is limited to ${max} h; ${fmt(expired)} h expires.` }],
  };
}

export function canUse(
  policy: AccrualPolicy,
  balance: number,
  pendingHours: number,
  hours: number,
): { ok: boolean; explain: Explain[] } {
  const available = round2(balance - pendingHours);
  if (policy.negativeAllowed) {
    return { ok: true, explain: [{ rule: 'leave.balance', message: 'This leave type may go below zero.' }] };
  }
  if (hours <= available) {
    return { ok: true, explain: [{ rule: 'leave.balance', message: `${fmt(available)} h available.` }] };
  }
  return {
    ok: false,
    explain: [
      {
        rule: 'leave.balance',
        message: `Only ${fmt(available)} h available (balance ${fmt(balance)} h, ${fmt(pendingHours)} h already requested); ${fmt(hours)} h needed.`,
      },
    ],
  };
}

export function balanceOf(entries: { hours: number }[]): number {
  return round2(entries.reduce((sum, e) => sum + e.hours, 0));
}
