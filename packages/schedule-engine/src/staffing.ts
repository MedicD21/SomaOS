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

/** One member on one seat for the day being evaluated. */
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
};

export type GroupCheck = { group: string; label: string; min: number; count: number; met: boolean };

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

function distinctIn(onDuty: OnDuty[], group: string, unitId?: string): Set<string> {
  return new Set(
    onDuty.filter((d) => d.groups.includes(group) && (unitId === undefined || d.unitId === unitId)).map((d) => d.memberId),
  );
}

export function evaluateStaffing(rules: StaffingRules, units: StaffingUnit[], onDuty: OnDuty[]): StaffingEvaluation {
  const violations: Explain[] = [];
  const department = rules.departmentMinimums.map(({ group, min }) => {
    const count = distinctIn(onDuty, group).size;
    const label = labelOf(rules, group);
    if (count < min) {
      violations.push({
        rule: 'staffing.department_below_minimum',
        message: `${count} ${label} on duty; the department minimum is ${min}`,
        data: { group, count, min },
      });
    }
    return { group, label, min, count, met: count >= min, shortfall: Math.max(0, min - count) };
  });

  const unitViews = units.map((u) => {
    const unitViolations: Explain[] = [];
    const checks = rules.unitRules
      .filter((r) => r.unitTypeKey === u.typeKey)
      .map(({ group, min }) => {
        const count = distinctIn(onDuty, group, u.id).size;
        const label = labelOf(rules, group);
        if (count < min) {
          unitViolations.push({
            rule: 'staffing.unit_below_minimum',
            message: `${u.name} has ${count} ${label}; at least ${min} required`,
            data: { unitId: u.id, group, count, min },
          });
        }
        return { group, label, min, count, met: count >= min };
      });
    violations.push(...unitViolations);
    return { unitId: u.id, name: u.name, checks, violations: unitViolations };
  });

  return { department, units: unitViews, violations, met: violations.length === 0 };
}

/**
 * TT suggestions: for each unit rule, when the department minimum for that group is met (or
 * none is set), fill each short unit from units holding more than the minimum. A donor never
 * drops below the minimum. Donors with the biggest surplus go first, then the one used least,
 * then by name. Within a donor, members not in an officer seat go first, then the highest seat.
 */
export function suggestTransfers(rules: StaffingRules, units: StaffingUnit[], onDuty: OnDuty[]): TransferSuggestion[] {
  const out: TransferSuggestion[] = [];
  const moved = new Set<string>();
  for (const rule of rules.unitRules) {
    const deptMin = rules.departmentMinimums.find((m) => m.group === rule.group);
    if (deptMin && distinctIn(onDuty, rule.group).size < deptMin.min) continue;

    const ruleUnits = units.filter((u) => u.typeKey === rule.unitTypeKey).sort((a, b) => a.name.localeCompare(b.name));
    const count = new Map(ruleUnits.map((u) => [u.id, distinctIn(onDuty, rule.group, u.id).size]));
    const used = new Map<string, number>();
    const label = labelOf(rules, rule.group);

    for (const short of ruleUnits) {
      while ((count.get(short.id) ?? 0) < rule.min) {
        const donors = ruleUnits
          .filter((u) => u.id !== short.id && (count.get(u.id) ?? 0) > rule.min)
          .sort(
            (a, b) =>
              (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0) ||
              (used.get(a.id) ?? 0) - (used.get(b.id) ?? 0) ||
              a.name.localeCompare(b.name),
          );
        const donor = donors[0];
        if (!donor) break;
        const candidate = onDuty
          .filter((d) => d.unitId === donor.id && d.groups.includes(rule.group) && !moved.has(d.memberId))
          .sort((a, b) => Number(a.seatHasMinRank) - Number(b.seatHasMinRank) || b.seatSort - a.seatSort)[0];
        if (!candidate) break;
        moved.add(candidate.memberId);
        count.set(donor.id, (count.get(donor.id) ?? 0) - 1);
        count.set(short.id, (count.get(short.id) ?? 0) + 1);
        used.set(donor.id, (used.get(donor.id) ?? 0) + 1);
        out.push({
          group: rule.group,
          fromUnitId: donor.id,
          fromUnitName: donor.name,
          toUnitId: short.id,
          toUnitName: short.name,
          memberId: candidate.memberId,
          memberName: candidate.memberName,
          seatLabel: candidate.seatLabel,
          explain: {
            rule: 'staffing.temporary_transfer',
            message: `Move ${candidate.memberName} (${label}) from ${donor.name} to ${short.name}; ${donor.name} keeps ${rule.min}`,
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
