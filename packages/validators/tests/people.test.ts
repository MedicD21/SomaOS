import { describe, expect, it } from 'vitest';
import { customFieldDefSchema, grantSchema, keyFromLabel, memberSchema, roleSchema } from '../src/index';

describe('memberSchema', () => {
  const base = { firstName: 'Riley', lastName: 'Medic', employmentType: 'career_full_time' };
  it('normalizes blanks to null', () => {
    const m = memberSchema.parse({ ...base, email: '', rankId: '', hireDate: '' });
    expect(m).toMatchObject({ email: null, rankId: null, hireDate: null });
  });
  it('rejects bad email and unknown employment types', () => {
    expect(memberSchema.safeParse({ ...base, email: 'nope' }).success).toBe(false);
    expect(memberSchema.safeParse({ ...base, employmentType: 'intern' }).success).toBe(false);
  });
});

describe('roleSchema', () => {
  it('only accepts catalog permissions', () => {
    expect(roleSchema.safeParse({ label: 'X', key: 'x', permissions: ['admin.members.view'] }).success).toBe(true);
    expect(roleSchema.safeParse({ label: 'X', key: 'x', permissions: ['admin.everything'] }).success).toBe(false);
  });
  it('derives keys from labels', () => {
    expect(keyFromLabel('Shift Scheduler')).toBe('shift_scheduler');
    expect(keyFromLabel('  EMS Officer / QA ')).toBe('ems_officer_qa');
    expect(keyFromLabel('2nd Due')).toBe('r_2nd_due');
  });
});

describe('grantSchema', () => {
  const base = { memberId: crypto.randomUUID(), roleId: crypto.randomUUID() };
  it('requires an org unit for org_unit scope', () => {
    expect(grantSchema.safeParse({ ...base, scopeKind: 'org_unit' }).success).toBe(false);
    expect(grantSchema.safeParse({ ...base, scopeKind: 'org_unit', scopeOrgUnitId: crypto.randomUUID() }).success).toBe(true);
  });
  it('drops org unit for department scope and rejects end before start', () => {
    const g = grantSchema.parse({ ...base, scopeKind: 'department', scopeOrgUnitId: crypto.randomUUID() });
    expect(g.scopeOrgUnitId).toBeNull();
    expect(
      grantSchema.safeParse({ ...base, scopeKind: 'department', validFrom: '2026-12-02', validTo: '2026-12-01' }).success,
    ).toBe(false);
  });
});

describe('customFieldDefSchema', () => {
  it('requires options for select types and parses "value:label" lines', () => {
    expect(customFieldDefSchema.safeParse({ label: 'Shirt', type: 'select', options: '' }).success).toBe(false);
    const d = customFieldDefSchema.parse({ label: 'Shirt size', type: 'select', options: 'm:Medium\nl' });
    expect(d).toMatchObject({ key: 'shirt_size', options: [{ value: 'm', label: 'Medium' }, { value: 'l', label: 'l' }] });
  });
});
