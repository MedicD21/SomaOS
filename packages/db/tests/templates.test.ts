import { afterAll, describe, expect, it } from 'vitest';
import { can, toGrants } from '@soma/auth';
import type { MyGrantRow } from '@soma/auth';
import { TEMPLATES, applyTemplate } from '@soma/templates';
import { shiftPatternSchema } from '@soma/validators';
import { asUser, closeTestDb, createTestUser, withAdmin } from '../src/test-harness';
import { createTenant } from './helpers';

afterAll(closeTestDb);

describe('applyTemplate', () => {
  it('is idempotent and makes the first admin a department admin', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const u = await createTestUser(tx);
      const admin = { userId: u, firstName: 'Dana', lastName: 'Chief' };
      await applyTemplate(tx, t, TEMPLATES['career-3-platoon'], admin);
      await applyTemplate(tx, t, TEMPLATES['career-3-platoon'], admin);

      const counts = await tx`
        select (select count(*)::int from shifts where tenant_id = ${t}) as shifts,
               (select count(*)::int from ranks where tenant_id = ${t}) as ranks,
               (select count(*)::int from members where tenant_id = ${t}) as members,
               (select count(*)::int from role_grants where tenant_id = ${t}) as grants`;
      expect(counts[0]).toEqual({ shifts: 3, ranks: 9, members: 1, grants: 1 });

      await asUser(tx, { sub: u, tenant_id: t }, async () => {
        const rows = await tx<MyGrantRow[]>`select * from app.my_grants()`;
        const me = (await tx`select app.my_member_id() as id`)[0]!.id as string;
        expect(can(toGrants(rows), me, 'admin.roles.manage', {}, new Date()).allowed).toBe(true);
      });
    });
  });

  it('volunteer template has no shifts', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const u = await createTestUser(tx);
      await applyTemplate(tx, t, TEMPLATES.volunteer, { userId: u, firstName: 'V', lastName: 'Chief' });
      const n = await tx`select count(*)::int as n from shifts where tenant_id = ${t}`;
      expect(n[0]!.n).toBe(0);
    });
  });

  it('career template creates credential types and one approved schedule pattern; volunteer none', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const u = await createTestUser(tx);
      const admin = { userId: u, firstName: 'Dana', lastName: 'Chief' };
      await applyTemplate(tx, t, TEMPLATES['career-3-platoon'], admin);
      await applyTemplate(tx, t, TEMPLATES['career-3-platoon'], admin);
      const types = await tx`select key from credential_types where tenant_id = ${t} order by key`;
      expect(types.map((r) => r.key)).toEqual(['aemt', 'cpr', 'driver_operator', 'emr', 'emt', 'paramedic']);
      const cfg = await tx`
        select key, version, status, payload, lower(effective) = ('2026-01-01'::timestamp at time zone 'America/Chicago') as anchored,
               upper_inf(effective) as open_ended
        from config_versions where tenant_id = ${t} and kind = 'schedule.pattern'`;
      expect(cfg).toHaveLength(1);
      expect(cfg[0]).toMatchObject({ key: 'default', version: 1, status: 'approved', anchored: true, open_ended: true });
      expect(shiftPatternSchema.safeParse(cfg[0]!.payload).success).toBe(true);
      const mods = await tx`select enabled_modules from tenant_settings where tenant_id = ${t}`;
      expect(mods[0]!.enabled_modules).toContain('scheduling');
    });
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const u = await createTestUser(tx);
      await applyTemplate(tx, t, TEMPLATES.volunteer, { userId: u, firstName: 'V', lastName: 'Chief' });
      const n = await tx`select (select count(*)::int from credential_types where tenant_id = ${t}) as types,
                                (select count(*)::int from config_versions where tenant_id = ${t} and kind = 'schedule.pattern') as patterns`;
      expect(n[0]).toEqual({ types: 6, patterns: 0 });
    });
  });
});
