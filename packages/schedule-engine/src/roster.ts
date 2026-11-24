import { resolveEffective, type ConfigVersion } from '@soma/config-core';
import type { Explain } from './explain';
import { expandPattern, isKellyShift, type ShiftPattern } from './pattern';
import { addDays, localDateOf, startOfLocalDay, type IsoDate } from './time';

export type StandingSeat = {
  memberId: string;
  seatId: string;
  platoon: string;
  kellyGroup: number | null;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
  tz: string;
};

export type MemberStatus = { memberId: string; separatedOn: IsoDate | null };

export type PlannedAssignment = {
  memberId: string;
  seatId: string | null;
  type: 'regular' | 'kelly';
  start: Date;
  end: Date;
  date: IsoDate;
  patternVersion: number;
  explain: Explain[];
};

const minDate = (...ds: (IsoDate | null)[]): IsoDate =>
  ds.filter((d): d is IsoDate => d !== null).reduce((a, b) => (a < b ? a : b));

export function planRegularRoster(input: {
  patterns: ConfigVersion<ShiftPattern>[];
  standing: StandingSeat[];
  members: MemberStatus[];
  from: IsoDate;
  toExclusive: IsoDate;
}): PlannedAssignment[] {
  const separated = new Map(input.members.map((m) => [m.memberId, m.separatedOn]));
  const out: PlannedAssignment[] = [];

  for (const s of input.standing) {
    const from = s.effectiveFrom > input.from ? s.effectiveFrom : input.from;
    const to = minDate(input.toExclusive, s.effectiveTo, separated.get(s.memberId) ?? null);
    if (from >= to) continue;

    for (const v of input.patterns) {
      const vFrom = localDateOf(v.effectiveFrom, s.tz);
      const vFromClipped = vFrom > from ? vFrom : from;
      // A mid-day effectiveTo still covers its local date; at local midnight the date itself is excluded.
      // resolveEffective below is authoritative.
      let vTo = to;
      if (v.effectiveTo !== null) {
        const endDate = localDateOf(v.effectiveTo, s.tz);
        const atMidnight = startOfLocalDay(endDate, s.tz).getTime() === v.effectiveTo.getTime();
        vTo = minDate(to, atMidnight ? endDate : addDays(endDate, 1));
      }
      if (vFromClipped >= vTo) continue;
      for (const inst of expandPattern(v.payload, s.platoon, vFromClipped, vTo, s.tz)) {
        if (resolveEffective(input.patterns, startOfLocalDay(inst.date, s.tz)) !== v) continue;
        const kelly = isKellyShift(v.payload, inst.index, s.kellyGroup);
        out.push({
          memberId: s.memberId,
          seatId: kelly ? null : s.seatId,
          type: kelly ? 'kelly' : 'regular',
          start: inst.start,
          end: inst.end,
          date: inst.date,
          patternVersion: v.version,
          explain: [
            {
              rule: 'pattern',
              message: `${v.key} v${v.version}: platoon ${s.platoon}, shift #${inst.index}`,
              data: { index: inst.index },
            },
            ...(kelly
              ? [{ rule: 'kelly', message: `Kelly day (group ${s.kellyGroup})` }]
              : [{ rule: 'standing_seat', message: `Standing seat ${s.seatId}` }]),
          ],
        });
      }
    }
  }

  return out.sort(
    (a, b) =>
      a.start.getTime() - b.start.getTime() || (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0),
  );
}
