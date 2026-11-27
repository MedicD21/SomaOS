import { describe, expect, it } from 'vitest';
import { isPermission } from '@soma/auth';
import { expandPattern } from '@soma/schedule-engine';
import { accrualPolicySchema, formFieldsSchema, payRulesSchema, shiftPatternSchema, validitySchema } from '@soma/validators';
import { TEMPLATES } from '../src/index';
import { DELCO_CREW_LEAVE_KEYS, DELCO_HOLIDAYS_2027, delcoEmsDraft as t } from '../src/drafts/delco-ems';

describe('Delaware County EMS draft template', () => {
  it('is not offered to other tenants', () => {
    expect(Object.keys(TEMPLATES)).not.toContain(t.key);
  });

  it('uses only real permissions', () => {
    for (const role of t.roles) for (const p of role.permissions) expect(isPermission(p), `${role.key}/${p}`).toBe(true);
  });

  it('has a valid pattern that puts 2 Unit on the days Aladtec shows', () => {
    expect(shiftPatternSchema.safeParse(t.schedulePattern?.payload).success).toBe(true);
    expect(Object.keys(t.schedulePattern!.payload.platoons).sort()).toEqual(t.shifts.map((s) => s.key).sort());
    const days = expandPattern(t.schedulePattern!.payload, 'unit_2', '2026-11-26', '2026-12-04', 'America/New_York').map((s) => s.date);
    expect(days).toEqual(['2026-11-27', '2026-11-30', '2026-12-03']);
  });

  it('credential validities parse and keys are unique', () => {
    for (const c of t.credentialTypes) expect(validitySchema.safeParse(c.validity).success, c.key).toBe(true);
    expect(new Set(t.credentialTypes.map((c) => c.key)).size).toBe(t.credentialTypes.length);
  });

  it('leave types reference real banks and every bank policy parses', () => {
    const banks = new Set(t.leave.banks.map((b) => b.key));
    expect(t.leave.types).toHaveLength(38);
    for (const lt of t.leave.types) if (lt.bankKey) expect(banks.has(lt.bankKey), lt.key).toBe(true);
    expect(new Set(t.leave.types.map((x) => x.key)).size).toBe(t.leave.types.length);
    for (const p of t.leave.policies) {
      expect(banks.has(p.bankKey)).toBe(true);
      const parsed = accrualPolicySchema.safeParse(p.payload);
      expect(parsed.success, `${p.bankKey}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it('pay codes cover every leave type and the rules only use known codes', () => {
    const keys = new Set(t.pay.codes.map((c) => c.key));
    expect(keys.size).toBe(t.pay.codes.length);
    for (const lt of t.leave.types) expect(keys.has(lt.key), lt.key).toBe(true);
    const groups = new Set(t.pay.groups.map((g) => g.key));
    for (const r of t.pay.rules) {
      expect(groups.has(r.groupKey)).toBe(true);
      const parsed = payRulesSchema.safeParse(r.payload);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      expect(keys.has(r.payload.workPeriod.code)).toBe(true);
      for (const a of Object.values(r.payload.assignments)) expect(keys.has(a.code), a.code).toBe(true);
      expect(t.leave.banks.map((b) => b.key)).toContain(r.payload.compTime.bankKey);
    }
  });

  it('carries the CBA numbers: 40 h weekly overtime, vacation tiers, sick rate, comp cap', () => {
    const rules = t.pay.rules[0]!.payload;
    expect(rules.workPeriod).toMatchObject({ days: 7, threshold: 40, multiplier: 1.5 });
    const vac = t.leave.policies.find((p) => p.bankKey === 'vacation')!.payload.tiers;
    // Annual hours / 26 pays, CBA 22.1.
    expect(vac.map((x) => [x.fromYears, x.earn.method === 'per_period' ? Math.round(x.earn.hours * 26) : null])).toEqual([[0, 0], [1, 120], [8, 168], [15, 216], [25, 264]]);
    expect(t.leave.policies.find((p) => p.bankKey === 'sick')!.payload.tiers[0]!.earn).toEqual({ method: 'per_hours_worked', perHours: 1, earnHours: 0.0656 });
    expect(t.leave.policies.find((p) => p.bankKey === 'comp_time')!.payload.cap).toBe(160);
  });

  it('crew-visible leave keys and the 2027 holidays are well formed', () => {
    const keys = new Set(t.leave.types.map((x) => x.key));
    for (const k of DELCO_CREW_LEAVE_KEYS) expect(keys.has(k), k).toBe(true);
    expect(DELCO_HOLIDAYS_2027).toHaveLength(13);
    expect(DELCO_HOLIDAYS_2027.filter((h) => h.hours === 4).map((h) => h.name)).toEqual(['Little Brown Jug Day', 'Christmas Eve']);
  });

  it('checklists have unique item keys and asset types exist', () => {
    const types = new Set(t.inventory.assetTypes.map((a) => a.key));
    for (const c of t.inventory.checklists) {
      expect(new Set(c.items.map((i) => i.key)).size, c.key).toBe(c.items.length);
      if (c.assetTypeKey) expect(types.has(c.assetTypeKey), c.key).toBe(true);
    }
    expect(t.inventory.checklists.map((c) => c.items.length)).toEqual([34, 57]);
  });

  it('forms are valid and training references real categories and credentials', () => {
    for (const f of t.documents.forms) expect(formFieldsSchema.safeParse(f.fields).success, f.key).toBe(true);
    const cats = new Set(t.training.categories.map((c) => c.key));
    const creds = new Set(t.credentialTypes.map((c) => c.key));
    for (const c of t.training.courses) {
      expect(cats.has(c.categoryKey), c.key).toBe(true);
      if (c.credentialTypeKey) expect(creds.has(c.credentialTypeKey), c.key).toBe(true);
    }
  });
});
