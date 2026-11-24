import { describe, expect, it } from 'vitest';
import { payRulesSchema } from '@soma/validators';
import { TEMPLATES } from '../src/index';

const career = TEMPLATES['career-3-platoon'];

describe('pay templates', () => {
  it('career template has a code for each pay need and one for every leave type', () => {
    const keys = career.pay.codes.map((c) => c.key);
    for (const k of ['reg', 'ot', 'hold', 'call', 'act']) expect(keys).toContain(k);
    for (const lt of career.leave.types) expect(keys, `leave type ${lt.key}`).toContain(lt.key);
    expect(career.pay.codes.filter((c) => c.kind === 'leave')).toHaveLength(career.leave.types.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every code the starter rules use exists, and the rules are valid', () => {
    for (const t of Object.values(TEMPLATES)) {
      const keys = new Set(t.pay.codes.map((c) => c.key));
      const groups = new Set(t.pay.groups.map((g) => g.key));
      for (const r of t.pay.rules) {
        expect(groups.has(r.groupKey), `${t.key} group ${r.groupKey}`).toBe(true);
        const parsed = payRulesSchema.safeParse(r.payload);
        expect(parsed.success, `${t.key}/${r.groupKey}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
        expect(keys.has(r.payload.workPeriod.code)).toBe(true);
        for (const a of Object.values(r.payload.assignments)) expect(keys.has(a.code), `code ${a.code}`).toBe(true);
        if (r.payload.compTime.mode !== 'never') expect(t.leave.banks.map((b) => b.key)).toContain(r.payload.compTime.bankKey);
      }
    }
  });

  it('starter rules carry the 28-day / 212 h fire work period as data and never enable comp time silently', () => {
    const rules = career.pay.rules.find((r) => r.groupKey === 'default')!.payload;
    expect(rules.workPeriod).toMatchObject({ days: 28, threshold: 212, multiplier: 1.5 });
    expect(rules.compTime.mode).toBe('never');
    expect(rules.overtimeCombination).toBe('highest');
  });

  it('the volunteer template carries no pay setup', () => {
    expect(TEMPLATES.volunteer.pay).toEqual({ codes: [], groups: [], rules: [] });
  });

  it('only payroll/HR and the admin can see or manage pay', () => {
    const has = (role: string, p: string) => career.roles.find((r) => r.key === role)!.permissions.includes(p as never);
    expect(has('payroll_hr', 'pay.view') && has('payroll_hr', 'pay.manage')).toBe(true);
    expect(has('dept_admin', 'pay.manage')).toBe(true);
    for (const k of ['member', 'company_officer', 'shift_commander', 'scheduler', 'auditor']) {
      expect(has(k, 'pay.view') || has(k, 'pay.manage'), k).toBe(false);
    }
  });
});
