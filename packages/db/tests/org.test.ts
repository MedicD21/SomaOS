import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { createTenant, expectTenantIsolation } from './helpers';

afterAll(closeTestDb);

async function unitType(tx: Tx, tenantId: string, key: string): Promise<string> {
  const r = await tx<{ id: string }[]>`
    insert into org_unit_types (tenant_id, key, label, sort) values (${tenantId}, ${key}, ${key}, 1)
    on conflict (tenant_id, key) do update set label = excluded.label returning id`;
  return r[0]!.id;
}

async function unit(tx: Tx, tenantId: string, typeKey: string, name: string, parentId: string | null) {
  const typeId = await unitType(tx, tenantId, typeKey);
  const r = await tx<{ id: string; path: string }[]>`
    insert into org_units (tenant_id, type_id, parent_id, name)
    values (${tenantId}, ${typeId}, ${parentId}, ${name}) returning id, path::text as path`;
  return r[0]!;
}

const pathOf = async (tx: Tx, id: string) =>
  (await tx<{ path: string }[]>`select path::text as path from org_units where id = ${id}`)[0]!.path;

describe('org units', () => {
  it('builds a materialized path from the parent chain', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const bat = await unit(tx, t, 'battalion', 'Battalion 1', null);
      const st = await unit(tx, t, 'station', 'Station 1', bat.id);
      expect(st.path.split('.')).toHaveLength(2);
      expect(st.path.startsWith(bat.path + '.')).toBe(true);
    });
  });

  it('rewrites descendant paths when a unit moves', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const d1 = await unit(tx, t, 'division', 'D1', null);
      const d2 = await unit(tx, t, 'division', 'D2', null);
      const b1 = await unit(tx, t, 'battalion', 'B1', d1.id);
      const s1 = await unit(tx, t, 'station', 'S1', b1.id);
      await tx`update org_units set parent_id = ${d2.id} where id = ${b1.id}`;
      const rows = await tx`select (${await pathOf(tx, s1.id)}::extensions.ltree <@ ${d2.path}::extensions.ltree) as inside`;
      expect(rows[0]!.inside).toBe(true);
    });
  });

  it('rejects moving a unit under its own descendant', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const b1 = await unit(tx, t, 'battalion', 'B1', null);
      const s1 = await unit(tx, t, 'station', 'S1', b1.id);
      await expectDbError(tx, /org unit cycle/, () =>
        tx`update org_units set parent_id = ${s1.id} where id = ${b1.id}`,
      );
      await expectDbError(tx, /org unit cycle/, () =>
        tx`update org_units set parent_id = ${b1.id} where id = ${b1.id}`,
      );
    });
  });

  it('rejects a parent from another tenant', async () => {
    await withAdmin(async (tx) => {
      const a = await createTenant(tx, 'A');
      const b = await createTenant(tx, 'B');
      const pa = await unit(tx, a, 'battalion', 'BA', null);
      await expectDbError(tx, /cross-tenant parent/, () => unit(tx, b, 'station', 'SB', pa.id));
    });
  });
});

describe('org tenant isolation', () => {
  it('isolates org_unit_types, org_units, ranks, shifts', async () => {
    await withAdmin(async (tx) => {
      await expectTenantIsolation(
        tx,
        'org_unit_types',
        (t) => unitType(tx, t, 'station').then(() => undefined),
        (t) => tx`insert into org_unit_types (tenant_id, key, label, sort) values (${t}, 'x', 'x', 1)`,
      );
      await expectTenantIsolation(
        tx,
        'ranks',
        async (t) => void (await tx`insert into ranks (tenant_id, key, label, sort) values (${t}, 'capt', 'Captain', 4)`),
        (t) => tx`insert into ranks (tenant_id, key, label, sort) values (${t}, 'x', 'x', 1)`,
      );
      await expectTenantIsolation(
        tx,
        'shifts',
        async (t) => void (await tx`insert into shifts (tenant_id, key, label, sort) values (${t}, 'a', 'A', 1)`),
        (t) => tx`insert into shifts (tenant_id, key, label, sort) values (${t}, 'x', 'x', 1)`,
      );
      await expectTenantIsolation(
        tx,
        'org_units',
        async (t) => void (await unit(tx, t, 'station', 'S', null)),
        (t) => tx`insert into org_units (tenant_id, type_id, name) values (${t}, gen_random_uuid(), 'x')`,
      );
    });
  });
});
