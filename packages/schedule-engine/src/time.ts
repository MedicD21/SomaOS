import { Temporal } from 'temporal-polyfill';

export type IsoDate = string;

export function addDays(d: IsoDate, n: number): IsoDate {
  return Temporal.PlainDate.from(d).add({ days: n }).toString();
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to), {
    largestUnit: 'days',
  }).days;
}

export function localDateOf(instant: Date, tz: string): IsoDate {
  return Temporal.Instant.fromEpochMilliseconds(instant.getTime())
    .toZonedDateTimeISO(tz)
    .toPlainDate()
    .toString();
}

export function startOfLocalDay(d: IsoDate, tz: string): Date {
  const z = Temporal.PlainDate.from(d).toZonedDateTime(tz);
  return new Date(z.epochMilliseconds);
}

/** Wall-clock date + HH:MM to an instant, DST gaps resolve forward. */
export function localToInstant(d: IsoDate, hhmm: string, tz: string): Date {
  return wallClockToInstant(Temporal.PlainDateTime.from(`${d}T${hhmm}`), tz);
}

/** Wall-clock start plus wall-clock hours (not exact hours), as an instant. */
export function localPlusHoursToInstant(
  d: IsoDate,
  hhmm: string,
  hours: number,
  tz: string,
): Date {
  const end = Temporal.PlainDateTime.from(`${d}T${hhmm}`).add({ hours });
  return wallClockToInstant(end, tz);
}

function wallClockToInstant(pdt: Temporal.PlainDateTime, tz: string): Date {
  return new Date(pdt.toZonedDateTime(tz, { disambiguation: 'compatible' }).epochMilliseconds);
}
