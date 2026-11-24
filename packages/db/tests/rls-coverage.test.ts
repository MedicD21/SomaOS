import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { closeTestDb, withAdmin } from '../src/test-harness';

afterAll(closeTestDb);

/** Public tables without RLS. Every table SomaOS creates must enable it. */
const tablesWithoutRls = async (tx: Tx) =>
  (await tx<{ relname: string }[]>`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1`).map((r) => r.relname);

describe('RLS coverage', () => {
  it('detects a table without RLS', async () => {
    await withAdmin(async (tx) => {
      await tx`create table public.tmp_without_rls (id int)`;
      expect(await tablesWithoutRls(tx)).toContain('tmp_without_rls');
    });
  });

  it('every public table has row-level security enabled', async () => {
    await withAdmin(async (tx) => {
      expect(await tablesWithoutRls(tx)).toEqual([]);
    });
  });

  it('every table with a tenant_id column has a policy referencing app.tenant_id()', async () => {
    await withAdmin(async (tx) => {
      const rows = await tx<{ table_name: string }[]>`
        select c.table_name from information_schema.columns c
        where c.table_schema = 'public' and c.column_name = 'tenant_id'
          and c.table_name not in ('audit_log', 'jobs')
          and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.table_name
                          and (p.qual like '%tenant_id()%' or p.with_check like '%tenant_id()%'))`;
      expect(rows.map((r) => r.table_name)).toEqual([]);
    });
  });
});
