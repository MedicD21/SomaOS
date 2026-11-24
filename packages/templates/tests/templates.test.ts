import { describe, expect, it } from 'vitest';
import { isPermission } from '@soma/auth';
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
