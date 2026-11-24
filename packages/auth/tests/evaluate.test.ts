import { describe, expect, it } from 'vitest';
import type { Grant } from '../src/evaluate';
import { can } from '../src/evaluate';

const NOW = new Date('2026-11-24T12:00:00Z');
const PAST = new Date('2026-01-01T00:00:00Z');
const ME = 'member-me';

function grant(partial: Partial<Grant>): Grant {
  return {
    permission: 'admin.members.view',
    scope: { kind: 'department' },
    shiftId: null,
    validFrom: PAST,
    validTo: null,
    roleKey: 'role_x',
    ...partial,
  };
}

describe('can', () => {
  it('department scope allows any target', () => {
    const d = can([grant({ roleKey: 'chief' })], ME, 'admin.members.view', { orgUnitPath: 'a.b.c' }, NOW);
    expect(d).toEqual({ allowed: true, reason: 'allowed by role chief (department)', matchedRole: 'chief' });
  });

  it('org_unit scope covers the unit and its descendants only', () => {
    const g = [grant({ scope: { kind: 'org_unit', path: 'a.b' }, roleKey: 'bc' })];
    expect(can(g, ME, 'admin.members.view', { orgUnitPath: 'a.b' }, NOW).allowed).toBe(true);
    expect(can(g, ME, 'admin.members.view', { orgUnitPath: 'a.b.c' }, NOW)).toMatchObject({
      allowed: true,
      reason: 'allowed by role bc (org_unit)',
    });
    expect(can(g, ME, 'admin.members.view', { orgUnitPath: 'a.x' }, NOW).allowed).toBe(false);
    expect(can(g, ME, 'admin.members.view', { orgUnitPath: 'a.bc' }, NOW).allowed).toBe(false);
    expect(can(g, ME, 'admin.members.view', {}, NOW).allowed).toBe(false);
  });

  it('self scope allows only own records', () => {
    const g = [grant({ scope: { kind: 'self' } })];
    expect(can(g, ME, 'admin.members.view', { ownerMemberId: ME }, NOW).allowed).toBe(true);
    expect(can(g, ME, 'admin.members.view', { ownerMemberId: 'other' }, NOW).allowed).toBe(false);
  });

  it('shift-restricted grant denies other shifts', () => {
    const g = [grant({ scope: { kind: 'org_unit', path: 'a' }, shiftId: 'B' })];
    expect(can(g, ME, 'admin.members.view', { orgUnitPath: 'a.s1', shiftId: 'B' }, NOW).allowed).toBe(true);
    expect(can(g, ME, 'admin.members.view', { orgUnitPath: 'a.s1', shiftId: 'C' }, NOW).allowed).toBe(false);
  });

  it('time-bound grant is active only within [validFrom, validTo)', () => {
    const to = new Date('2026-11-25T07:00:00Z');
    const g = [grant({ validFrom: new Date('2026-11-24T07:00:00Z'), validTo: to })];
    expect(can(g, ME, 'admin.members.view', {}, NOW).allowed).toBe(true);
    expect(can(g, ME, 'admin.members.view', {}, to).allowed).toBe(false);
    expect(can(g, ME, 'admin.members.view', {}, new Date('2026-11-24T06:59:59Z')).allowed).toBe(false);
  });

  it('explains a denial', () => {
    expect(can([], ME, 'admin.roles.manage', {}, NOW)).toEqual({
      allowed: false,
      reason: 'no active grant for admin.roles.manage covering target',
    });
  });

  it('ignores grants for other permissions', () => {
    expect(can([grant({})], ME, 'admin.roles.manage', {}, NOW).allowed).toBe(false);
  });
});

describe('toGrants', () => {
  it('maps app.my_grants() rows and drops unknown permissions', async () => {
    const { toGrants } = await import('../src/evaluate');
    const grants = toGrants([
      {
        permission: 'admin.roles.manage',
        scope_kind: 'org_unit',
        scope_path: 'a.b',
        scope_shift_id: null,
        valid_from: PAST,
        valid_to: null,
        role_key: 'bc',
      },
      { permission: 'legacy.thing', scope_kind: 'department', scope_path: null, scope_shift_id: null, valid_from: PAST, valid_to: null, role_key: 'x' },
    ]);
    expect(grants).toEqual([
      { permission: 'admin.roles.manage', scope: { kind: 'org_unit', path: 'a.b' }, shiftId: null, validFrom: PAST, validTo: null, roleKey: 'bc' },
    ]);
  });
});
