import 'server-only';
import type { PayPeriodResult } from './load';

/** Quote when needed; defuse spreadsheet formulas ("=", "+", "-", "@") in free-text cells. */
function text(value: string | null | undefined): string {
  let v = value ?? '';
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

const num = (n: number | null): string => (n === null ? '' : String(n));
const money = (n: number | null): string => (n === null ? '' : n.toFixed(2));

const HEADER = ['Member', 'Employee number', 'Pay code', 'Export code', 'Hours', 'Rate', 'Amount', 'Notes'];

/**
 * One row per member and pay code (plus a comp-credit row when comp time was earned). `exportCodes`
 * maps pay code keys to the code a payroll system expects; unknown keys export with an empty code.
 */
export function payCsv(result: PayPeriodResult, exportCodes: Map<string, string | null>): string {
  const out: string[] = [HEADER.join(',')];
  for (const m of result.rows) {
    const who = [text(m.name), text(m.employeeNumber)];
    if (!m.result) {
      out.push([...who, '', '', '', '', '', text(m.problem)].join(','));
      continue;
    }
    for (const l of m.result.lines) {
      const note = l.compensated ? 'Taken as comp time' : l.source === 'callback_minimum' ? 'Callback minimum' : '';
      out.push([...who, text(l.code), text(exportCodes.get(l.code) ?? ''), num(l.hours), num(l.rate), money(l.amount), note].join(','));
    }
    if (m.result.comp.hours > 0) {
      out.push([...who, text(m.result.comp.bankKey ?? 'comp'), '', num(m.result.comp.hours), '', '', 'Comp time credited'].join(','));
    }
  }
  return `${out.join('\r\n')}\r\n`;
}
