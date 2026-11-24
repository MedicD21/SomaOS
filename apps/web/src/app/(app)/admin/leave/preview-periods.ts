import { accrualPeriods, type AccrualPolicy, type Period } from '@soma/schedule-engine';

/** The accrual period of `policy.period` that contains `date`. */
export function periods(p: AccrualPolicy['period'], date: string): Period {
  const first = accrualPeriods(p, date, nextDay(date))[0];
  if (!first) throw new Error('No accrual period for that date');
  return first;
}

function nextDay(d: string): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
