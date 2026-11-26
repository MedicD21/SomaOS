import { Temporal } from 'temporal-polyfill';
import type { Explain } from './explain';
import { addDays, daysBetween, type IsoDate } from './time';

/**
 * Training requirement windows and compliance. Pure: the web compliance page and the reminder job both call
 * `trainingCompliance`, so there is exactly one rule for "who is due".
 */
export type TrainingWindow =
  | { kind: 'calendar_year' }
  | { kind: 'rolling_months'; months: number }
  | { kind: 'fixed_cycle'; month: number; day: number; years: number };

export type TrainingRequirement = {
  id: string;
  label: string;
  categoryId: string;
  rankId: string | null;
  roleId: string | null;
  requiredHours: number;
  window: TrainingWindow;
  effectiveFrom: IsoDate;
  /** Inclusive; null = open ended. */
  effectiveTo: IsoDate | null;
};

export type TrainingMember = { id: string; rankId: string | null; roleIds: string[] };
export type TrainingHours = { memberId: string; categoryId: string; creditedOn: IsoDate; hours: number };

export type ComplianceStatus = 'met' | 'on_track' | 'due_soon' | 'overdue';

export type ComplianceRow = {
  memberId: string;
  requirementId: string;
  categoryId: string;
  earned: number;
  required: number;
  remaining: number;
  status: ComplianceStatus;
  windowStart: IsoDate;
  windowEnd: IsoDate;
  explain: Explain[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const plain = (d: IsoDate) => Temporal.PlainDate.from(d);

/** month/day in a year; February 29 falls back to February 28 in non-leap years. */
function cutoff(year: number, month: number, day: number): Temporal.PlainDate {
  return Temporal.PlainDate.from({ year, month, day }, { overflow: 'constrain' });
}

/**
 * The window (inclusive dates) that contains `today`.
 * - calendar_year: January 1 to December 31.
 * - rolling_months: the last N months ending today (no fixed end, so it is never "due soon").
 * - fixed_cycle: cycles end on month/day every `years` years, counted from the first such date on or after
 *   `anchor` (the requirement's effective date); the first cycle starts at the anchor.
 */
export function windowFor(w: TrainingWindow, today: IsoDate, anchor: IsoDate = today): { start: IsoDate; end: IsoDate } {
  const t = plain(today);
  if (w.kind === 'calendar_year') return { start: `${t.year}-01-01`, end: `${t.year}-12-31` };
  if (w.kind === 'rolling_months') {
    return { start: addDays(t.subtract({ months: w.months }).toString(), 1), end: today };
  }
  const a = plain(anchor);
  let end = cutoff(a.year, w.month, w.day);
  if (Temporal.PlainDate.compare(end, a) < 0) end = cutoff(a.year + 1, w.month, w.day);
  let start: IsoDate = anchor;
  // Walk forward cycle by cycle until the cycle contains today (cycles are years long, so this is a few steps).
  const first = end;
  let k = 0;
  while (Temporal.PlainDate.compare(end, t) < 0) {
    start = addDays(end.toString(), 1);
    k += 1;
    end = cutoff(first.year + k * w.years, w.month, w.day);
  }
  return { start, end: end.toString() };
}

function applies(r: TrainingRequirement, m: TrainingMember, onDate: IsoDate): boolean {
  if (r.effectiveFrom > onDate) return false;
  if (r.effectiveTo !== null && r.effectiveTo < onDate) return false;
  if (r.rankId !== null && r.rankId !== m.rankId) return false;
  if (r.roleId !== null && !m.roleIds.includes(r.roleId)) return false;
  return true;
}

function earnedIn(hours: TrainingHours[], memberId: string, categoryId: string, start: IsoDate, end: IsoDate): number {
  return round2(
    hours
      .filter((h) => h.memberId === memberId && h.categoryId === categoryId && h.creditedOn >= start && h.creditedOn <= end)
      .reduce((s, h) => s + h.hours, 0),
  );
}

export type ComplianceInput = {
  requirements: TrainingRequirement[];
  members: TrainingMember[];
  /** Hours earned (attended or partial sessions that were not cancelled), one row per credited session. */
  hours: TrainingHours[];
  today: IsoDate;
  /** A short window is `due_soon` when it ends within this many days. Default 30. */
  dueSoonDays?: number;
  /** A window that just ended short stays `overdue` for this many days, then the next window takes over. Default 30. */
  overdueGraceDays?: number;
};

/**
 * One row per member and applicable requirement. Hours outside the window never count, earlier windows are not
 * carried into later ones, and only the member's own rank and roles are considered.
 */
export function trainingCompliance(input: ComplianceInput): ComplianceRow[] {
  const dueSoonDays = input.dueSoonDays ?? 30;
  const grace = input.overdueGraceDays ?? 30;
  const rows: ComplianceRow[] = [];
  for (const m of input.members) {
    for (const r of input.requirements) {
      // Use the window that contains today, unless the previous one just ended short (then report that as overdue).
      const { start, end } = windowFor(r.window, input.today, r.effectiveFrom);
      if (r.window.kind !== 'rolling_months') {
        const prevEnd = addDays(start, -1);
        if (daysBetween(prevEnd, input.today) <= grace && prevEnd >= r.effectiveFrom && applies(r, m, prevEnd)) {
          const prev = windowFor(r.window, prevEnd, r.effectiveFrom);
          const prevEarned = earnedIn(input.hours, m.id, r.categoryId, prev.start, prev.end);
          if (prevEarned < r.requiredHours) {
            rows.push({
              memberId: m.id, requirementId: r.id, categoryId: r.categoryId, earned: prevEarned, required: r.requiredHours,
              remaining: round2(r.requiredHours - prevEarned), status: 'overdue', windowStart: prev.start, windowEnd: prev.end,
              explain: [{
                rule: 'training.overdue',
                message: `${r.label}: needed ${r.requiredHours} h by ${prev.end}; ${prevEarned} h earned, ${round2(r.requiredHours - prevEarned)} h short.`,
                data: { requirementId: r.id, windowEnd: prev.end },
              }],
            });
            continue;
          }
        }
      }
      if (!applies(r, m, input.today)) continue;
      const earned = earnedIn(input.hours, m.id, r.categoryId, start, end);
      const remaining = round2(Math.max(0, r.requiredHours - earned));
      let status: ComplianceStatus;
      const explain: Explain[] = [];
      if (earned >= r.requiredHours) {
        status = 'met';
        explain.push({ rule: 'training.met', message: `${r.label}: ${earned} of ${r.requiredHours} h earned (${start} to ${end}).` });
      } else if (r.window.kind === 'rolling_months') {
        status = 'overdue';
        explain.push({
          rule: 'training.overdue',
          message: `${r.label}: ${earned} of ${r.requiredHours} h in the last ${r.window.months} months; ${remaining} h short.`,
          data: { requirementId: r.id, windowEnd: end },
        });
      } else if (daysBetween(input.today, end) <= dueSoonDays) {
        status = 'due_soon';
        explain.push({
          rule: 'training.due_soon',
          message: `${r.label}: ${remaining} h still needed by ${end} (${earned} of ${r.requiredHours} h earned).`,
          data: { requirementId: r.id, windowEnd: end },
        });
      } else {
        status = 'on_track';
        explain.push({
          rule: 'training.on_track',
          message: `${r.label}: ${earned} of ${r.requiredHours} h earned; ${remaining} h to go by ${end}.`,
        });
      }
      rows.push({
        memberId: m.id, requirementId: r.id, categoryId: r.categoryId, earned, required: r.requiredHours, remaining, status,
        windowStart: start, windowEnd: end, explain,
      });
    }
  }
  return rows;
}
