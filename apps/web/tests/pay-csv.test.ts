import { describe, expect, it } from 'vitest';
import type { PayResult } from '@soma/schedule-engine';
import { payCsv } from '@/server/pay/csv';
import type { MemberPayRow, PayPeriodResult } from '@/server/pay/load';

const result = (over: Partial<PayResult> = {}): PayResult => ({
  lines: [
    { code: 'reg', multiplier: 1, hours: 96, rate: 31.25, amount: 3000, source: 'work', compensated: false, explain: [] },
    { code: 'ot', multiplier: 1.5, hours: 24, rate: 31.25, amount: 1125, source: 'work', compensated: false, explain: [] },
  ],
  totalHours: 120,
  totalAmount: 4125,
  comp: { bankKey: null, hours: 0 },
  explain: [],
  ...over,
});
const row = (over: Partial<MemberPayRow> = {}): MemberPayRow => ({
  memberId: 'm1', name: 'Medic, Riley', employeeNumber: '1042', groupKey: 'default', rate: 31.25, result: result(), problem: null, notes: [], ...over,
});
const period = (rows: MemberPayRow[]): PayPeriodResult => ({ period: { start: '2026-01-01', endExclusive: '2026-01-29' }, rows });
const codes = new Map([['reg', 'REG'], ['ot', 'OT'], ['comp_time', null]]);

describe('payCsv', () => {
  it('writes a header and one row per member and pay code with export codes and cents', () => {
    const lines = payCsv(period([row()]), codes).trim().split('\r\n');
    expect(lines[0]).toBe('Member,Employee number,Pay code,Export code,Hours,Rate,Amount,Notes');
    expect(lines[1]).toBe('"Medic, Riley",1042,reg,REG,96,31.25,3000.00,');
    expect(lines[2]).toBe('"Medic, Riley",1042,ot,OT,24,31.25,1125.00,');
    expect(lines).toHaveLength(3);
  });

  it('leaves amounts and rates empty when there is no rate', () => {
    const noRate = row({ rate: null, result: result({ lines: result().lines.map((l) => ({ ...l, rate: null, amount: null })), totalAmount: null }) });
    expect(payCsv(period([noRate]), codes)).toContain(',96,,,');
  });

  it('writes comp-time lines as zero cash and adds a comp credit row', () => {
    const comp = row({
      result: result({
        lines: [{ code: 'ot', multiplier: 1.5, hours: 10, rate: 31.25, amount: 0, source: 'work', compensated: true, explain: [] }],
        comp: { bankKey: 'comp_time', hours: 15 },
      }),
    });
    const lines = payCsv(period([comp]), codes).trim().split('\r\n');
    expect(lines[1]).toBe('"Medic, Riley",1042,ot,OT,10,31.25,0.00,Taken as comp time');
    expect(lines[2]).toBe('"Medic, Riley",1042,comp_time,,15,,,Comp time credited');
  });

  it('reports members without a result as a single explained row', () => {
    const lines = payCsv(period([row({ result: null, problem: 'No approved pay rules for group "default" on 2026-01-01.' })]), codes).trim().split('\r\n');
    expect(lines[1]).toBe('"Medic, Riley",1042,,,,,,"No approved pay rules for group ""default"" on 2026-01-01."');
  });

  it('neutralises spreadsheet formulas and quotes embedded quotes and line breaks', () => {
    const evil = row({ name: '=HYPERLINK("http://x")', employeeNumber: '@1', result: result({ lines: result().lines.slice(0, 1) }) });
    const out = payCsv(period([evil]), codes);
    expect(out).toContain(`"'=HYPERLINK(""http://x"")",'@1,reg,REG,96`);
    const multi = payCsv(period([row({ name: 'Line\nBreak', result: result({ lines: result().lines.slice(0, 1) }) })]), codes);
    expect(multi).toContain('"Line\nBreak",1042');
  });
});
