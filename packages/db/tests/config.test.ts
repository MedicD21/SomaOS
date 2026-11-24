import { afterAll, describe, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { createMember, createRole, createTenant, expectTenantIsolation, grantRole, userInTenant } from './helpers';

afterAll(closeTestDb);

const insertVersion = (tx: Tx, t: string, version: number, status: string, range: string) =>
  tx`insert into config_versions (tenant_id, kind, key, version, status, effective, payload)
     values (${t}, 'pay', 'ot', ${version}, ${status}, ${range}::tstzrange, '{"threshold":212}')`;

describe('config_versions', () => {
  it('rejects overlapping approved versions for the same kind/key', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      await insertVersion(tx, t, 1, 'approved', '[2026-01-01,2026-07-01)');
      await expectDbError(tx, /config_versions_no_overlap/, () =>
        insertVersion(tx, t, 2, 'approved', '[2026-06-01,)'),
      );
    });
  });

  it('allows drafts to overlap approved versions and back-to-back approved versions', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      await insertVersion(tx, t, 1, 'approved', '[2026-01-01,2026-07-01)');
      await insertVersion(tx, t, 2, 'draft', '[2026-06-01,)');
      await insertVersion(tx, t, 3, 'approved', '[2026-07-01,)');
    });
  });

  it('requires admin.config.manage to approve', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const u = await userInTenant(tx, t);
      await createMember(tx, t, { userId: u });
      await asUser(tx, { sub: u, tenant_id: t }, async () => {
        await insertVersion(tx, t, 1, 'draft', '[2026-01-01,)');
        await expectDbError(tx, /row-level security/, () =>
          tx`update config_versions set status = 'approved' where version = 1 returning id`.then((r) => {
            if (r.length === 0) throw new Error('row-level security: no rows updated');
          }),
        );
      });
    });
  });

  it('lets a config admin approve and then freezes the payload', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const u = await userInTenant(tx, t);
      const m = await createMember(tx, t, { userId: u });
      await grantRole(tx, t, m, await createRole(tx, t, 'cfg', ['admin.config.manage']));
      await asUser(tx, { sub: u, tenant_id: t }, async () => {
        await insertVersion(tx, t, 1, 'draft', '[2026-01-01,)');
        await tx`update config_versions set status = 'approved' where version = 1`;
        await expectDbError(tx, /approved config is immutable/, () =>
          tx`update config_versions set payload = '{"threshold":1}' where version = 1`,
        );
      });
    });
  });

  it('is tenant isolated', async () => {
    await withAdmin(async (tx) => {
      await expectTenantIsolation(
        tx,
        'config_versions',
        async (t) => void (await insertVersion(tx, t, 1, 'draft', '[2026-01-01,)')),
        (t) => insertVersion(tx, t, 9, 'draft', '[2026-01-01,)'),
      );
    });
  });
});
