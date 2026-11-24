import { afterAll, describe, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { createTenant, expectTenantIsolation } from './helpers';

afterAll(closeTestDb);

const insertDef = (tx: Tx, t: string, key: string, type = 'text') =>
  tx`insert into custom_field_defs (tenant_id, entity, key, label, type) values (${t}, 'member', ${key}, ${key}, ${type})`;

describe('custom_field_defs', () => {
  it('rejects keys that are not snake_case identifiers', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      await expectDbError(tx, /custom_field_defs_key_check/, () => insertDef(tx, t, 'Badge Number'));
    });
  });

  it('rejects duplicate keys per entity and unknown types', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      await insertDef(tx, t, 'badge');
      await expectDbError(tx, /duplicate key/, () => insertDef(tx, t, 'badge'));
      await expectDbError(tx, /custom_field_defs_type_check/, () => insertDef(tx, t, 'x', 'blob'));
    });
  });

  it('is tenant isolated', async () => {
    await withAdmin(async (tx) => {
      await expectTenantIsolation(tx, 'custom_field_defs', async (t) => void (await insertDef(tx, t, 'a')), (t) =>
        insertDef(tx, t, 'b'),
      );
    });
  });
});
