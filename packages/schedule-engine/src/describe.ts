import type { AccrualPolicy, EarnRule } from './accrual';
import type { ShiftPattern } from './pattern';
import type { PayRules, WorkType } from './pay';
import { WORK_TYPES } from './pay';

/** Plain-English sentences for rule documents. Pure: the same document always gives the same lines. */

const num = (n: number): string => String(Math.round((n + Number.EPSILON) * 100) / 100);
const plural = (n: number, one: string, many = `${one}s`): string => `${num(n)} ${n === 1 ? one : many}`;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const WORK_PLURAL: Partial<Record<WorkType, string>> = { callback: 'Callbacks' };

export function describePayRules(r: PayRules): string[] {
  const lines: string[] = [];
  lines.push(
    r.payPeriod.kind === 'monthly'
      ? 'Pay periods are calendar months.'
      : `Pay periods are ${plural(r.payPeriod.days, 'day')} long, starting ${r.payPeriod.anchor}.`,
  );
  const wp = r.workPeriod;
  lines.push(
    `Overtime starts after ${num(wp.threshold)} h worked in each ${wp.days}-day work period (starting ${wp.anchor}) and is paid at ${num(wp.multiplier)}x under "${wp.code}".`,
  );
  lines.push(
    r.overtimeCombination === 'highest'
      ? 'An hour that is both contract overtime and over the threshold is paid at the larger multiplier, once.'
      : 'An hour that is both contract overtime and over the threshold adds the premiums (for example 1.5x and 1.5x together pay 2x).',
  );
  for (const t of WORK_TYPES) {
    const a = r.assignments[t];
    lines.push(`${cap(t)} shifts are paid under "${a.code}" at ${num(a.multiplier)}x.`);
    if (a.countsTowardFlsa === false) lines.push(`${cap(t)} hours do not count toward the overtime threshold.`);
    if (a.minimumHours) {
      lines.push(`${WORK_PLURAL[t] ?? `${cap(t)} shifts`} are guaranteed ${num(a.minimumHours)} h; the top-up is paid but is not time worked.`);
    }
  }
  const c = r.compTime;
  if (c.mode === 'never') {
    lines.push('Overtime is never taken as comp time.');
  } else if (!c.bankKey) {
    lines.push('Comp time is switched on but no leave bank is chosen, so it cannot be credited yet.');
  } else if (c.mode === 'always') {
    lines.push(
      `Overtime and other premium hours are always taken as comp time: ${num(c.multiplier)}x the hours is credited to "${c.bankKey}" and no cash is paid for them.`,
    );
  } else {
    lines.push(
      `Members who ask for it take overtime and other premium hours as comp time (${num(c.multiplier)}x the hours credited to "${c.bankKey}"); everyone else is paid cash.`,
    );
  }
  return lines;
}

function describeEarn(e: EarnRule): string {
  switch (e.method) {
    case 'per_period':
      return `${num(e.hours)} h each period.`;
    case 'per_hours_worked':
      return `${num(e.earnHours)} h for every ${num(e.perHours)} h worked.`;
    case 'annual_front_load':
      return `${num(e.hours)} h credited at the start of each year.`;
    case 'manual':
      return 'no automatic accrual; balances are changed by hand.';
  }
}

export function describeAccrualPolicy(p: AccrualPolicy): string[] {
  const lines: string[] = [];
  lines.push(
    p.period.kind === 'monthly'
      ? 'Accrual is calculated every month.'
      : `Accrual is calculated every ${plural(p.period.days, 'day')} (starting ${p.period.anchor}).`,
  );
  for (const t of p.tiers) lines.push(`From ${plural(t.fromYears, 'year')} of service: ${describeEarn(t.earn)}`);
  lines.push(p.cap === null ? 'There is no balance cap.' : `Earning stops when the balance reaches ${num(p.cap)} h.`);
  lines.push(
    p.waitingPeriodDays > 0
      ? `No accrual until ${plural(p.waitingPeriodDays, 'day')} after the hire date.`
      : 'Accrual starts on the hire date.',
  );
  lines.push(p.prorateFirstPeriod ? 'The first period is prorated by the days employed.' : 'The first period is not prorated.');
  for (const [type, f] of Object.entries(p.fractionByEmploymentType)) {
    lines.push(`${type} earns ${Math.round(f * 100)}% of the normal amount.`);
  }
  lines.push(p.negativeAllowed ? 'Balances may go negative.' : 'Balances cannot go negative.');
  if (p.carryover.resetOn === null) {
    lines.push('Balances carry over without limit.');
  } else if (p.carryover.max === null) {
    lines.push(`On ${p.carryover.resetOn}, the whole balance carries over.`);
  } else {
    lines.push(`On ${p.carryover.resetOn}, any balance above ${num(p.carryover.max)} h is forfeited.`);
  }
  return lines;
}

/** "1 on, 2 off" style runs for a cycle, starting at day 1. */
function cycleRuns(cycle: ShiftPattern['cycle']): string {
  const runs: string[] = [];
  let i = 0;
  while (i < cycle.length) {
    let j = i;
    while (j < cycle.length && cycle[j] === cycle[i]) j++;
    runs.push(`${j - i} ${cycle[i]}`);
    i = j;
  }
  return runs.join(', ');
}

export function describePattern(p: ShiftPattern, shiftKeys: string[]): string[] {
  const lines: string[] = [];
  lines.push(`The cycle is ${plural(p.cycle.length, 'day')}: ${cycleRuns(p.cycle)}.`);
  lines.push(`Each shift starts at ${p.shiftStart} and lasts ${num(p.shiftHours)} h.`);
  const onDays = p.cycle.filter((c) => c === 'on').length;
  lines.push(`That averages ${num((onDays / p.cycle.length) * 7 * p.shiftHours)} h per week.`);
  for (const k of shiftKeys) {
    const o = p.platoons[k];
    lines.push(o === undefined ? `Shift "${k}" has no offset yet.` : `Shift "${k}" starts the cycle ${plural(o, 'day')} after ${p.anchorDate}.`);
  }
  lines.push(p.kelly ? `Every ${p.kelly.everyNthShift}th shift is a Kelly day for the member in that Kelly group.` : 'There are no Kelly days.');
  return lines;
}
