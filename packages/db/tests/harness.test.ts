import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { asUser, closeTestDb, withAdmin, withUser } from '../src/test-harness';
import { createTenant, userInTenant } from './helpers';

afterAll(closeTestDb);

describe('test harness', () => {
  it('exposes the tenant claim through app.tenant_id() for an active member', async () => {
    await withAdmin(async (tx) => {
      const tenantId = await createTenant(tx);
      const u = await userInTenant(tx, tenantId);
      await asUser(tx, { sub: u, tenant_id: tenantId }, async () => {
        const rows = await tx`select app.tenant_id() as t, current_user as u`;
        expect(rows[0]?.t).toBe(tenantId);
        expect(rows[0]?.u).toBe('authenticated');
      });
    });
  });

  it('ignores a tenant claim without a matching membership', async () => {
    const rows = await withUser({ sub: randomUUID(), tenant_id: randomUUID() }, (tx) => tx`select app.tenant_id() as t`);
    expect(rows[0]?.t).toBeNull();
  });

  it('clears claims after asUser so later setup runs as superuser', async () => {
    await withAdmin(async (tx) => {
      await asUser(tx, { sub: randomUUID(), tenant_id: null }, async () => undefined);
      expect((await tx`select auth.uid() as u`)[0]?.u).toBeNull();
    });
  });

  it('returns null tenant when claim is null', async () => {
    const rows = await withUser({ sub: randomUUID(), tenant_id: null }, (tx) =>
      tx`select app.tenant_id() as t`,
    );
    expect(rows[0]?.t).toBeNull();
  });
});
