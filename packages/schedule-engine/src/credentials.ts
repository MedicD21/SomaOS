import { Temporal } from 'temporal-polyfill';
import type { Explain } from './explain';
import { addDays, daysBetween, startOfLocalDay, localDateOf, type IsoDate } from './time';

export type Validity =
  | { kind: 'none' }
  | { kind: 'months'; months: number }
  | { kind: 'fixed_cycle'; month: number; day: number; years: number };

/** Last valid local date (inclusive), or null when the credential never expires. */
export function credentialExpiry(v: Validity, issuedOn: IsoDate): IsoDate | null {
  if (v.kind === 'none') return null;
  const issued = Temporal.PlainDate.from(issuedOn);
  if (v.kind === 'months') return issued.add({ months: v.months }).toString();
  const cutoffThisYear = Temporal.PlainDate.from({
    year: issued.year,
    month: v.month,
    day: v.day,
  });
  const extra = Temporal.PlainDate.compare(issued, cutoffThisYear) > 0 ? 1 : 0;
  return Temporal.PlainDate.from({
    year: issued.year + v.years + extra,
    month: v.month,
    day: v.day,
  }).toString();
}

/** True when a credential expiring on `expiresOn` (inclusive, local date) still covers `shiftEnd`. */
export function validThroughShift(expiresOn: IsoDate | null, shiftEnd: Date, tz: string): boolean {
  return expiresOn === null || shiftEnd.getTime() <= startOfLocalDay(addDays(expiresOn, 1), tz).getTime();
}

export type SeatRequirement = { anyOf: string[] }[];
export type SeatRule = {
  requirements: SeatRequirement;
  minRankSort: number | null;
  actingAllowed: boolean;
};
export type MemberQual = {
  rankSort: number | null;
  credentials: { typeId: string; typeLabel: string; expiresOn: IsoDate | null }[];
};

export function checkQualification(
  seat: SeatRule,
  member: MemberQual,
  shiftEnd: Date,
  tz: string,
): { qualified: boolean; acting: boolean; explain: Explain[] } {
  const explain: Explain[] = [];
  let qualified = true;
  let acting = false;

  for (const group of seat.requirements) {
    const held = member.credentials.filter((c) => group.anyOf.includes(c.typeId));
    if (held.some((c) => validThroughShift(c.expiresOn, shiftEnd, tz))) continue;
    qualified = false;
    if (held.length === 0) {
      explain.push({
        rule: 'credential.missing',
        message: `Missing required credential (any of: ${group.anyOf.join(', ')})`,
        data: { anyOf: [...group.anyOf] },
      });
      continue;
    }
    for (const c of held) {
      explain.push({
        rule: 'credential.expired_before_shift_end',
        message: `${c.typeLabel} expires ${c.expiresOn ?? ''}, before this shift ends`,
        data: { typeId: c.typeId, expiresOn: c.expiresOn, shiftEndLocalDate: localDateOf(shiftEnd, tz) },
      });
    }
  }

  if (seat.minRankSort !== null) {
    const below = member.rankSort === null || member.rankSort > seat.minRankSort;
    if (below) {
      const data = { rankSort: member.rankSort, minRankSort: seat.minRankSort };
      if (seat.actingAllowed) {
        acting = true;
        explain.push({
          rule: 'rank.acting',
          message: 'Below minimum rank for this seat; qualified as acting',
          data,
        });
      } else {
        qualified = false;
        explain.push({
          rule: 'rank.below_minimum',
          message: 'Below minimum rank for this seat',
          data,
        });
      }
    }
  }

  return { qualified, acting: qualified && acting, explain };
}

/**
 * Warning threshold due now, or null. Past expiry yields 0 once. A missed day
 * warns once at the smallest crossed threshold; skipped thresholds are not replayed.
 */
export function dueWarning(
  expiresOn: IsoDate,
  today: IsoDate,
  warnDays: number[],
  lastWarnedDays: number | null,
): number | null {
  const daysUntil = daysBetween(today, expiresOn);
  if (daysUntil < 0) return lastWarnedDays === 0 ? null : 0;
  const eligible = warnDays
    .filter((t) => daysUntil <= t && (lastWarnedDays === null || t < lastWarnedDays))
    .sort((a, b) => a - b);
  return eligible[0] ?? null;
}
