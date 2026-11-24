import { describe, expect, it } from 'vitest';
import { accrualPolicySchema } from '@soma/validators';
import { TEMPLATES } from '../src/index';

const career = TEMPLATES['career-3-platoon'];
const role = (key: string) => career.roles.find((r) => r.key === key)!.permissions;

describe('leave templates', () => {
  it('career template has four banks, seven leave types and a policy per bank', () => {
    expect(career.leave.banks.map((b) => b.key).sort()).toEqual(['comp_time', 'holiday', 'sick', 'vacation']);
    expect(career.leave.types).toHaveLength(7);
    expect(career.leave.policies.map((p) => p.bankKey).sort()).toEqual(['comp_time', 'holiday', 'sick', 'vacation']);
  });

  it('every policy is valid and every reference resolves', () => {
    for (const t of Object.values(TEMPLATES)) {
      const banks = new Set(t.leave.banks.map((b) => b.key));
      for (const p of t.leave.policies) {
        expect(banks.has(p.bankKey), `${t.key} policy ${p.bankKey}`).toBe(true);
        const r = accrualPolicySchema.safeParse(p.payload);
        expect(r.success, `${t.key}/${p.bankKey}: ${JSON.stringify(r.error?.issues)}`).toBe(true);
      }
      for (const lt of t.leave.types) expect(lt.bankKey === null || banks.has(lt.bankKey), `${t.key}/${lt.key}`).toBe(true);
    }
  });

  it('comp time is a manual bank with the public-safety cap as policy data', () => {
    const comp = career.leave.policies.find((p) => p.bankKey === 'comp_time')!;
    expect(comp.payload.tiers).toEqual([{ fromYears: 0, earn: { method: 'manual' } }]);
    expect(comp.payload.cap).toBe(480);
  });

  it('types without a balance exist for FMLA, bereavement and military leave', () => {
    const noBank = career.leave.types.filter((t) => t.bankKey === null).map((t) => t.key).sort();
    expect(noBank).toEqual(['bereavement', 'fmla', 'military']);
    expect(career.leave.types.find((t) => t.key === 'fmla')?.requiresDocumentation).toBe(true);
  });

  it('volunteer template carries balance-free types only', () => {
    const v = TEMPLATES.volunteer;
    expect(v.leave.banks).toEqual([]);
    expect(v.leave.policies).toEqual([]);
    expect(v.leave.types.every((t) => t.bankKey === null)).toBe(true);
  });

  it('gives members the right leave permissions', () => {
    expect(role('member')).toContain('leave.request');
    expect(role('volunteer')).toContain('leave.request');
    for (const k of ['company_officer', 'shift_commander', 'chief_officer']) {
      expect(role(k)).toEqual(expect.arrayContaining(['leave.approve', 'leave.view']));
    }
    expect(role('payroll_hr')).toEqual(expect.arrayContaining(['leave.view', 'leave.manage']));
    expect(role('dept_admin')).toEqual(expect.arrayContaining(['leave.request', 'leave.approve', 'leave.view', 'leave.manage']));
    expect(role('external')).toEqual([]);
  });
});
