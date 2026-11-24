import type { AccrualPolicy } from './accrual';
import type { Explain } from './explain';
import type { IsoDate } from './time';
import { addDays, daysBetween } from './time';

export type WorkType = 'regular' | 'overtime' | 'trade' | 'holdover' | 'callback' | 'acting' | 'training' | 'detail';

export const WORK_TYPES: readonly WorkType[] = ['regular', 'overtime', 'trade', 'holdover', 'callback', 'acting', 'training', 'detail'];

export type AssignmentPay = {
  code: string;
  multiplier: number;
  /** Whether these hours move the member toward the work-period threshold. Default true. */
  countsTowardFlsa?: boolean;
  /** Guaranteed paid hours (e.g. callbacks); the shortfall is paid but is not time worked. */
  minimumHours?: number;
};

export type PayRules = {
  payPeriod: AccrualPolicy['period'];
  /** FLSA 7(k)-style work period: hours worked above `threshold` are paid at `multiplier` under `code`. */
  workPeriod: { days: number; anchor: IsoDate; threshold: number; multiplier: number; code: string };
  /** How contract and federal overtime combine on the same hour. */
  overtimeCombination: 'highest' | 'stack';
  assignments: Record<WorkType, AssignmentPay>;
  compTime: { mode: 'never' | 'always' | 'member_choice'; multiplier: number; bankKey: string | null };
};

export type WorkSegment = { id: string; date: IsoDate; hours: number; type: WorkType };
export type LeaveSegment = { id: string; date: IsoDate; hours: number; code: string; countsAsWorked: boolean };

export type PayLine = {
  code: string;
  multiplier: number;
  hours: number;
  rate: number | null;
  amount: number | null;
  source: 'work' | 'leave' | 'callback_minimum';
  /** Overtime taken as comp time instead of cash: carries no amount. */
  compensated: boolean;
  explain: Explain[];
};

export type PayResult = {
  lines: PayLine[];
  totalHours: number;
  totalAmount: number | null;
  comp: { bankKey: string | null; hours: number };
  explain: Explain[];
};

const round2 = (n: number): number => (Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-9)) / 100;

/** The work period (a block of `days` aligned to the anchor) that contains `date`. */
export function workPeriodOf(wp: PayRules['workPeriod'], date: IsoDate): { start: IsoDate; endExclusive: IsoDate } {
  const blocks = Math.floor(daysBetween(wp.anchor, date) / wp.days);
  const start = addDays(wp.anchor, blocks * wp.days);
  return { start, endExclusive: addDays(start, wp.days) };
}

type Piece = Omit<PayLine, 'rate' | 'amount' | 'compensated'> & { compensated: boolean };

type Event =
  | { date: IsoDate; id: string; kind: 'work'; seg: WorkSegment }
  | { date: IsoDate; id: string; kind: 'leave'; seg: LeaveSegment };

/**
 * Hours and dollars by pay code for one member and pay period. Pure: callers supply every segment
 * from the start of the earliest work period touching the period, so overtime thresholds are right
 * even when the work period is longer than the pay period. Segments before the period only move
 * the running total; only segments inside the period produce lines.
 */
export function computePay(input: {
  rules: PayRules;
  hourlyRate: number | null;
  prefersComp: boolean;
  segments: WorkSegment[];
  leave: LeaveSegment[];
  period: { start: IsoDate; endExclusive: IsoDate };
}): PayResult {
  const { rules, hourlyRate, period } = input;
  const wp = rules.workPeriod;
  const inPeriod = (d: IsoDate) => d >= period.start && d < period.endExclusive;
  const comp = rules.compTime.mode === 'always' || (rules.compTime.mode === 'member_choice' && input.prefersComp);

  const events: Event[] = [
    ...input.segments.filter((s) => s.hours > 0).map((seg): Event => ({ date: seg.date, id: seg.id, kind: 'work', seg })),
    ...input.leave.filter((l) => l.hours > 0).map((seg): Event => ({ date: seg.date, id: seg.id, kind: 'leave', seg })),
  ].sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.date < b.date ? -1 : 1));

  const running = new Map<IsoDate, number>();
  const pieces: Piece[] = [];
  const explain: Explain[] = [];

  for (const ev of events) {
    const period0 = workPeriodOf(wp, ev.date).start;
    const before = running.get(period0) ?? 0;

    if (ev.kind === 'leave') {
      if (ev.seg.countsAsWorked) running.set(period0, before + ev.seg.hours);
      if (inPeriod(ev.date)) {
        pieces.push({ code: ev.seg.code, multiplier: 1, hours: ev.seg.hours, source: 'leave', compensated: false,
          explain: [{ rule: 'pay.leave', message: `${ev.seg.hours} h of paid leave on ${ev.date} (${ev.seg.countsAsWorked ? 'counts toward' : 'does not count toward'} the work-period threshold).` }] });
      }
      continue;
    }

    const seg = ev.seg;
    const pay = rules.assignments[seg.type];
    if (!pay) throw new RangeError(`Pay rules have no code for assignment type "${seg.type}"`);
    const counts = pay.countsTowardFlsa !== false;
    const regularHours = counts ? Math.min(seg.hours, Math.max(0, wp.threshold - before)) : seg.hours;
    const flsaHours = counts ? round2(seg.hours - regularHours) : 0;
    if (counts) running.set(period0, before + seg.hours);
    if (!inPeriod(ev.date)) continue;

    const push = (hours: number, code: string, multiplier: number, why: Explain) => {
      if (hours <= 0) return;
      pieces.push({ code, multiplier, hours: round2(hours), source: 'work', compensated: comp && multiplier > 1, explain: [why] });
    };

    push(regularHours, pay.code, pay.multiplier, {
      rule: 'pay.assignment',
      message: `${seg.type} on ${seg.date}: ${round2(regularHours)} h at ${pay.multiplier}× as ${pay.code}.`,
    });

    if (flsaHours > 0) {
      const federal = wp.multiplier;
      const at = `${round2(flsaHours)} h on ${seg.date} are above the ${wp.threshold} h threshold in the work period starting ${period0}`;
      if (rules.overtimeCombination === 'stack') {
        const m = 1 + (pay.multiplier - 1) + (federal - 1);
        push(flsaHours, wp.code, m, { rule: 'pay.flsa', message: `${at}: federal ${federal}× stacked on ${pay.code} ${pay.multiplier}× = ${round2(m)}× as ${wp.code}.` });
      } else if (federal > pay.multiplier) {
        push(flsaHours, wp.code, federal, { rule: 'pay.flsa', message: `${at}: federal ${federal}× is higher than ${pay.code} ${pay.multiplier}×, paid as ${wp.code}.` });
      } else {
        push(flsaHours, pay.code, pay.multiplier, { rule: 'pay.flsa', message: `${at}: ${pay.code} ${pay.multiplier}× is at least the federal ${federal}×, paid as ${pay.code}.` });
      }
    }

    if (pay.minimumHours && seg.hours < pay.minimumHours) {
      const shortfall = round2(pay.minimumHours - seg.hours);
      pieces.push({ code: pay.code, multiplier: pay.multiplier, hours: shortfall, source: 'callback_minimum', compensated: false,
        explain: [{ rule: 'pay.minimum', message: `${seg.type} minimum of ${pay.minimumHours} h on ${seg.date}: ${shortfall} h added to the ${round2(seg.hours)} h worked (not counted as time worked).` }] });
    }
  }

  for (const start of new Set(events.filter((e) => inPeriod(e.date)).map((e) => workPeriodOf(wp, e.date).start))) {
    explain.push({
      rule: 'pay.work_period',
      message: `Work period starting ${start}: ${round2(running.get(start) ?? 0)} h counted so far against a ${wp.threshold} h threshold.`,
    });
  }

  const grouped = new Map<string, Piece>();
  for (const p of pieces) {
    const key = `${p.code}|${p.multiplier}|${p.source}|${p.compensated}`;
    const g = grouped.get(key);
    if (!g) grouped.set(key, { ...p, explain: [...p.explain] });
    else {
      g.hours = round2(g.hours + p.hours);
      for (const e of p.explain) if (!g.explain.some((x) => x.message === e.message)) g.explain.push(e);
    }
  }

  const lines: PayLine[] = [...grouped.values()]
    .map((p) => ({
      ...p,
      rate: hourlyRate,
      amount: hourlyRate === null ? null : p.compensated ? 0 : round2(hourlyRate * p.multiplier * p.hours),
    }))
    .sort((a, b) => (a.code === b.code ? (a.multiplier === b.multiplier ? (a.source < b.source ? -1 : 1) : a.multiplier - b.multiplier) : a.code < b.code ? -1 : 1));

  const compHours = round2(lines.filter((l) => l.compensated).reduce((s, l) => s + l.hours * rules.compTime.multiplier, 0));
  return {
    lines,
    totalHours: round2(lines.reduce((s, l) => s + l.hours, 0)),
    totalAmount: hourlyRate === null ? null : round2(lines.reduce((s, l) => s + (l.amount ?? 0), 0)),
    comp: { bankKey: rules.compTime.bankKey, hours: compHours },
    explain,
  };
}
