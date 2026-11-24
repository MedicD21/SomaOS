import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, withUser } from '../src/test-harness';

afterAll(closeTestDb);

describe('test harness', () => {
  it('exposes tenant_id claim through app.tenant_id()', async () => {
    const tenantId = randomUUID();
    const rows = await withUser({ sub: randomUUID(), tenant_id: tenantId }, (tx) =>
      tx`select app.tenant_id() as t, current_user as u`,
    );
    expect(rows[0]?.t).toBe(tenantId);
    expect(rows[0]?.u).toBe('authenticated');
  });

  it('returns null tenant when claim is null', async () => {
    const rows = await withUser({ sub: randomUUID(), tenant_id: null }, (tx) =>
      tx`select app.tenant_id() as t`,
    );
    expect(rows[0]?.t).toBeNull();
  });
});
