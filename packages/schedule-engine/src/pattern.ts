import { addDays, daysBetween, localPlusHoursToInstant, localToInstant } from './time';
import type { IsoDate } from './time';

export type ShiftPattern = {
  cycle: ('on' | 'off')[];
  shiftStart: string;
  shiftHours: number;
  anchorDate: IsoDate;
  platoons: Record<string, number>;
  kelly?: { everyNthShift: number };
};

export type ShiftInstance = {
  date: IsoDate;
  start: Date;
  end: Date;
  hours: number;
  index: number;
};

const floorDiv = (a: number, b: number): number => Math.floor(a / b);
const mod = (a: number, b: number): number => ((a % b) + b) % b;

export function expandPattern(
  p: ShiftPattern,
  platoon: string,
  from: IsoDate,
  toExclusive: IsoDate,
  tz: string,
): ShiftInstance[] {
  const offset = p.platoons[platoon];
  if (offset === undefined) throw new Error(`Unknown platoon: ${platoon}`);
  const len = p.cycle.length;
  if (len === 0) return [];
  const onPerCycle = p.cycle.filter((c) => c === 'on').length;
  const out: ShiftInstance[] = [];
  for (let d = from; d < toExclusive; d = addDays(d, 1)) {
    const rel = daysBetween(p.anchorDate, d) - offset;
    const pos = mod(rel, len);
    if (p.cycle[pos] !== 'on') continue;
    const onBefore = p.cycle.slice(0, pos).filter((c) => c === 'on').length;
    const index = floorDiv(rel, len) * onPerCycle + onBefore;
    const start = localToInstant(d, p.shiftStart, tz);
    const end = localPlusHoursToInstant(d, p.shiftStart, p.shiftHours, tz);
    out.push({ date: d, start, end, hours: (end.getTime() - start.getTime()) / 3.6e6, index });
  }
  return out;
}

export function isKellyShift(p: ShiftPattern, index: number, kellyGroup: number | null): boolean {
  if (!p.kelly || kellyGroup === null) return false;
  return mod(index, p.kelly.everyNthShift) === kellyGroup;
}
