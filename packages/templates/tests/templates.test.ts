import { describe, expect, it } from 'vitest';
import { isPermission } from '@soma/auth';
import { shiftPatternSchema } from '@soma/validators';
import { TEMPLATES } from '../src/index';

describe('department templates', () => {
  it('only reference permissions that exist in the catalog', () => {
    for (const t of Object.values(TEMPLATES)) {
      for (const role of t.roles) {
        for (const p of role.permissions) expect(isPermission(p), `${t.key}/${role.key}/${p}`).toBe(true);
      }
    }
  });

  it('every template has a dept_admin role holding admin.roles.manage', () => {
    for (const t of Object.values(TEMPLATES)) {
      const admin = t.roles.find((r) => r.key === 'dept_admin');
      expect(admin?.permissions).toContain('admin.roles.manage');
    }
  });

  it('career template ranks are ordered by seniority', () => {
    const ranks = TEMPLATES['career-3-platoon'].ranks;
    expect(ranks).toHaveLength(9);
    expect(ranks[0]).toMatchObject({ key: 'fire_chief', sort: 1 });
    expect(ranks.at(-1)).toMatchObject({ key: 'probationary_ff', sort: 9 });
  });
});

describe('scheduling templates', () => {
  it('career template carries six credential types and a valid default pattern', () => {
    const t = TEMPLATES['career-3-platoon'];
    expect(t.credentialTypes.map((c) => c.key).sort()).toEqual(['aemt', 'cpr', 'driver_operator', 'emr', 'emt', 'paramedic']);
    expect(t.schedulePattern?.key).toBe('default');
    expect(shiftPatternSchema.safeParse(t.schedulePattern?.payload).success).toBe(true);
    expect(Object.keys(t.schedulePattern!.payload.platoons).sort()).toEqual(t.shifts.map((s) => s.key).sort());
    expect(t.enabledModules).toContain('scheduling');
  });

  it('volunteer template has credential types but no pattern', () => {
    expect(TEMPLATES.volunteer.credentialTypes).toHaveLength(6);
    expect(TEMPLATES.volunteer.schedulePattern).toBeNull();
    expect(TEMPLATES.volunteer.enabledModules).toContain('scheduling');
  });

  it('scheduling permissions land on the right roles', () => {
    const roles = Object.fromEntries(TEMPLATES['career-3-platoon'].roles.map((r) => [r.key, r.permissions]));
    expect(roles.scheduler).toEqual(expect.arrayContaining(['scheduling.roster.view', 'scheduling.roster.edit', 'scheduling.config.manage', 'scheduling.qualification.override']));
    expect(roles.chief_officer).toEqual(expect.arrayContaining(['scheduling.roster.view', 'scheduling.roster.edit', 'scheduling.qualification.override']));
    expect(roles.payroll_hr).toEqual(expect.arrayContaining(['credentials.view', 'credentials.manage', 'scheduling.roster.view']));
    expect(roles.training_officer).toEqual(expect.arrayContaining(['credentials.view', 'credentials.manage']));
    expect(roles.member).toContain('scheduling.roster.view');
    expect(roles.member).toContain('scheduling.trade.request');
    expect(roles.company_officer).toContain('scheduling.trade.request');
    expect(roles.external).not.toContain('scheduling.trade.request');
    expect(roles.company_officer).not.toContain('scheduling.config.manage');
  });
});
