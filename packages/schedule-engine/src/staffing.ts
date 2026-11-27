import type { Explain } from './explain';
import { validThroughShift } from './credentials';
import type { IsoDate } from './time';

/**
 * Minimum staffing, temporary-transfer (TT) suggestions and mandate-list candidates.
 * All numbers come from the department's `staffing.rules` configuration; nothing here is
 * specific to one department.
 */

/** A set of credential types that count together (e.g. "ALS" = Paramedic or AEMT). */
export type StaffingGroup = { key: string; label: string; credentialKeys: string[] };

export type StaffingRules = {
  groups: StaffingGroup[];
  /** Distinct group members on duty across the department. */
  departmentMinimums: { group: string; min: number }[];
  /** Group members on duty in every unit of the given org unit type. */
  unitRules: { group: string; unitTypeKey: string; min: number }[];
};

export type StaffingUnit = { id: string; name: string; typeKey: string };

/** The stretch of time checked, usually one operational day (e.g. 06:00 to 06:00 local). */
export type StaffingWindow = { start: Date; end: Date; tz: string };

/** One member on one seat for one shift that overlaps the window. */
export type OnDuty = {
  memberId: string;
  memberName: string;
  unitId: string;
  seatId: string;
  seatLabel: string;
  seatSort: number;
  /** The seat has a minimum rank (an officer seat); a TT prefers to leave it alone. */
  seatHasMinRank: boolean;
  /** Group keys this member counts for on this shift (see `memberGroups`). */
  groups: string[];
  start: Date;
  end: Date;
};

/** A stretch of the window below a minimum, with the lowest count during it. */
export type Gap = { from: Date; to: Date; count: number };

/** `count` is the lowest number on duty at any moment of the window; `gaps` are the times below `min`. */
export type GroupCheck = { group: string; label: string; min: number; count: number; met: boolean; gaps: Gap[] };

export type StaffingEvaluation = {
  department: (GroupCheck & { shortfall: number })[];
  units: { unitId: string; name: string; checks: GroupCheck[]; violations: Explain[] }[];
  violations: Explain[];
  met: boolean;
};

export type TransferSuggestion = {
  group: string;
  fromUnitId: string;
  fromUnitName: string;
  toUnitId: string;
  toUnitName: string;
  memberId: string;
  memberName: string;
  seatLabel: string;
  start: Date;
  explain: Explain;
};

/** Groups a member counts for: any credential of the group, valid through the end of the shift. */
export function memberGroups(
  rules: StaffingRules,
  credentials: { key: string; expiresOn: IsoDate | null }[],
  shiftEnd: Date,
  tz: string,
): string[] {
  const valid = new Set(credentials.filter((c) => validThroughShift(c.expiresOn, shiftEnd, tz)).map((c) => c.key));
  return rules.groups.filter((g) => g.credentialKeys.some((k) => valid.has(k))).map((g) => g.key);
}

const labelOf = (rules: StaffingRules, group: string): string => rules.groups.find((g) => g.key === group)?.label ?? group;

type Segment = { from: number; to: number; count: number };

/**
 * Piecewise-constant head count over the window: distinct members of `group` (in `unitId` when
 * given) on duty in each stretch between shift starts and ends. A shift counts on [start, end).
 */
function segments(onDuty: OnDuty[], group: string, window: StaffingWindow, unitId?: string): Segment[] {
  const ws = window.start.getTime();
  const we = window.end.getTime();
  const rows = onDuty.filter(
    (d) => d.groups.includes(group) && (unitId === undefined || d.unitId === unitId) && d.start.getTime() < we && d.end.getTime() > ws,
  );
  const points = new Set([ws, we]);
  for (const r of rows) {
    for (const t of [r.start.getTime(), r.end.getTime()]) if (t > ws && t < we) points.add(t);
  }
  const sorted = [...points].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const from = sorted[i]!;
    const members = new Set(rows.filter((r) => r.start.getTime() <= from && r.end.getTime() > from).map((r) => r.memberId));
    out.push({ from, to: sorted[i + 1]!, count: members.size });
  }
  return out;
}

const lowest = (segs: Segment[]): number => (segs.length ? Math.min(...segs.map((s) => s.count)) : 0);

function gapsBelow(segs: Segment[], min: number): Gap[] {
  const gaps: Gap[] = [];
  let open: { from: number; to: number; count: number } | null = null;
  for (const s of segs) {
    if (s.count < min) {
      if (open && open.to === s.from) {
        open.to = s.to;
        open.count = Math.min(open.count, s.count);
      } else {
        if (open) gaps.push({ from: new Date(open.from), to: new Date(open.to), count: open.count });
        open = { ...s };
      }
    }
  }
  if (open) gaps.push({ from: new Date(open.from), to: new Date(open.to), count: open.count });
  return gaps;
}

const deficitMs = (segs: Segment[], min: number): number =>
  segs.reduce((n, s) => n + (s.count < min ? (min - s.count) * (s.to - s.from) : 0), 0);

function clock(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

/** "12:00–12:20 (4 on duty)", joined with "; ". */
export function describeGaps(gaps: Gap[], tz: string): string {
  return gaps.map((g) => `${clock(g.from, tz)}–${clock(g.to, tz)} (${g.count} on duty)`).join('; ');
}

function check(group: string, label: string, min: number, segs: Segment[]): GroupCheck {
  const count = lowest(segs);
  return { group, label, min, count, met: count >= min, gaps: gapsBelow(segs, min) };
}

/** Checks every minimum at every moment of the window: a dip of any length is a violation. */
export function evaluateStaffing(rules: StaffingRules, units: StaffingUnit[], onDuty: OnDuty[], window: StaffingWindow): StaffingEvaluation {
  const violations: Explain[] = [];
  const department = rules.departmentMinimums.map(({ group, min }) => {
    const label = labelOf(rules, group);
    const c = check(group, label, min, segments(onDuty, group, window));
    if (!c.met) {
      violations.push({
        rule: 'staffing.department_below_minimum',
        message: `${label} below the department minimum of ${min}: ${describeGaps(c.gaps, window.tz)}`,
        data: { group, lowest: c.count, min },
      });
    }
    return { ...c, shortfall: Math.max(0, min - c.count) };
  });

  const unitViews = units.map((u) => {
    const unitViolations: Explain[] = [];
    const checks = rules.unitRules
      .filter((r) => r.unitTypeKey === u.typeKey)
      .map(({ group, min }) => {
        const label = labelOf(rules, group);
        const c = check(group, label, min, segments(onDuty, group, window, u.id));
        if (!c.met) {
          unitViolations.push({
            rule: 'staffing.unit_below_minimum',
            message: `${u.name} below ${min} ${label}: ${describeGaps(c.gaps, window.tz)}`,
            data: { unitId: u.id, group, lowest: c.count, min },
          });
        }
        return c;
      });
    violations.push(...unitViolations);
    return { unitId: u.id, name: u.name, checks, violations: unitViolations };
  });

  return { department, units: unitViews, violations, met: violations.length === 0 };
}

/**
 * TT suggestions: for each unit rule, when the department minimum for that group holds for the
 * whole window (or none is set), cover each short unit from other units of the same type. A move
 * is suggested only if the donor still meets the minimum at every moment afterwards and the short
 * unit's gap shrinks. Donors with the biggest surplus go first, then the one used least, then by
 * name; within a donor, members not in an officer seat go first, then the highest seat.
 */
export function suggestTransfers(rules: StaffingRules, units: StaffingUnit[], onDuty: OnDuty[], window: StaffingWindow): TransferSuggestion[] {
  const out: TransferSuggestion[] = [];
  const rows = onDuty.map((d) => ({ ...d }));
  const moved = new Set<number>();
  for (const rule of rules.unitRules) {
    const deptMin = rules.departmentMinimums.find((m) => m.group === rule.group);
    if (deptMin && lowest(segments(rows, rule.group, window)) < deptMin.min) continue;

    const ruleUnits = units.filter((u) => u.typeKey === rule.unitTypeKey).sort((a, b) => a.name.localeCompare(b.name));
    const ruleUnitIds = new Set(ruleUnits.map((u) => u.id));
    const byId = new Map(ruleUnits.map((u) => [u.id, u]));
    const segsOf = (unitId: string) => segments(rows, rule.group, window, unitId);
    const used = new Map<string, number>();
    const label = labelOf(rules, rule.group);

    for (const short of ruleUnits) {
      while (lowest(segsOf(short.id)) < rule.min) {
        const before = deficitMs(segsOf(short.id), rule.min);
        const beforeLowest = lowest(segsOf(short.id));
        const surplus = new Map(ruleUnits.map((u) => [u.id, lowest(segsOf(u.id)) - rule.min]));
        const candidates = rows
          .map((r, i) => ({ r, i }))
          .filter(({ r, i }) => !moved.has(i) && r.unitId !== short.id && ruleUnitIds.has(r.unitId) && r.groups.includes(rule.group))
          .sort(
            (a, b) =>
              (surplus.get(b.r.unitId) ?? 0) - (surplus.get(a.r.unitId) ?? 0) ||
              (used.get(a.r.unitId) ?? 0) - (used.get(b.r.unitId) ?? 0) ||
              byId.get(a.r.unitId)!.name.localeCompare(byId.get(b.r.unitId)!.name) ||
              Number(a.r.seatHasMinRank) - Number(b.r.seatHasMinRank) ||
              b.r.seatSort - a.r.seatSort,
          );
        let accepted: { r: OnDuty; i: number; donor: StaffingUnit } | null = null;
        for (const { r, i } of candidates) {
          const donor = byId.get(r.unitId)!;
          r.unitId = short.id;
          const donorOk = lowest(segsOf(donor.id)) >= rule.min;
          const improved = lowest(segsOf(short.id)) > beforeLowest || deficitMs(segsOf(short.id), rule.min) < before;
          if (donorOk && improved) {
            accepted = { r, i, donor };
            break;
          }
          r.unitId = donor.id;
        }
        if (!accepted) break;
        const { r, i, donor } = accepted;
        moved.add(i);
        used.set(donor.id, (used.get(donor.id) ?? 0) + 1);
        out.push({
          group: rule.group,
          fromUnitId: donor.id,
          fromUnitName: donor.name,
          toUnitId: short.id,
          toUnitName: short.name,
          memberId: r.memberId,
          memberName: r.memberName,
          seatLabel: r.seatLabel,
          start: r.start,
          explain: {
            rule: 'staffing.temporary_transfer',
            message: `Move ${r.memberName} (${label}, shift from ${clock(r.start, window.tz)}) from ${donor.name} to ${short.name}; ${donor.name} keeps ${rule.min}`,
            data: { group: rule.group, min: rule.min },
          },
        });
      }
    }
  }
  return out;
}

export type MandateEntry = {
  memberId: string;
  name: string;
  position: number;
  exemptReason: string | null;
  /** Last exempt local date (inclusive); null = until cleared. */
  exemptUntil: IsoDate | null;
};

export type MandateStatus = 'eligible' | 'exempt' | 'working' | 'on_leave' | 'not_qualified' | 'skipped' | 'separated';

export type MandateCandidate = { memberId: string; name: string; position: number; status: MandateStatus; reason?: string };

export type MandateContext = {
  date: IsoDate;
  /** Already scheduled during the hole. */
  working: Set<string>;
  /** Pending or approved leave that day. */
  onLeave: Set<string>;
  /** In the staffing group the hole needs. */
  qualified: Set<string>;
  separated: Set<string>;
  /** Skipped for this date by an officer. */
  skipped: Set<string>;
};

export const MANDATE_STATUS_LABEL: Record<MandateStatus, string> = {
  eligible: 'Next up',
  exempt: 'Exempt',
  working: 'Already working',
  on_leave: 'On leave',
  not_qualified: 'Not qualified',
  skipped: 'Skipped today',
  separated: 'Separated',
};

/** Every entry in list order with why it can or cannot be mandated; the first `eligible` is next up. */
export function mandateCandidates(entries: MandateEntry[], ctx: MandateContext): MandateCandidate[] {
  return [...entries]
    .sort((a, b) => a.position - b.position)
    .map((e) => {
      const base = { memberId: e.memberId, name: e.name, position: e.position };
      if (ctx.separated.has(e.memberId)) return { ...base, status: 'separated' as const };
      if (e.exemptReason && (e.exemptUntil === null || ctx.date <= e.exemptUntil)) {
        return { ...base, status: 'exempt' as const, reason: e.exemptReason };
      }
      if (!ctx.qualified.has(e.memberId)) return { ...base, status: 'not_qualified' as const };
      if (ctx.working.has(e.memberId)) return { ...base, status: 'working' as const };
      if (ctx.onLeave.has(e.memberId)) return { ...base, status: 'on_leave' as const };
      if (ctx.skipped.has(e.memberId)) return { ...base, status: 'skipped' as const };
      return { ...base, status: 'eligible' as const };
    });
}
