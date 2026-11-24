import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { createMember, createRole, createTenant, grantRole, userInTenant } from './helpers';

afterAll(closeTestDb);

async function uploader(tx: Tx, t: string, perms = ['files.upload', 'files.view']) {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u });
  await grantRole(tx, t, m, await createRole(tx, t, `f_${m.slice(0, 6)}`, perms));
  return u;
}

const putObject = (tx: Tx, name: string) =>
  tx`insert into storage.objects (bucket_id, name, owner_id) values ('tenant-files', ${name}, auth.uid()::text)`;

describe('tenant-files storage bucket', () => {
  it('is private with a 25 MB limit', async () => {
    await withAdmin(async (tx) => {
      const [b] = await tx`select public, file_size_limit::int as file_size_limit from storage.buckets where id = 'tenant-files'`;
      expect(b).toMatchObject({ public: false, file_size_limit: 26214400 });
    });
  });

  it('allows uploads only under the caller’s tenant prefix', async () => {
    await withAdmin(async (tx) => {
      const a = await createTenant(tx, 'A');
      const b = await createTenant(tx, 'B');
      const u = await uploader(tx, a);
      await asUser(tx, { sub: u, tenant_id: a }, async () => {
        await putObject(tx, `${a}/member/x/1-ok.pdf`);
        await expectDbError(tx, /row-level security/, () => putObject(tx, `${b}/member/x/2-bad.pdf`));
      });
    });
  });

  it('hides other tenants’ objects and requires files.upload to upload', async () => {
    await withAdmin(async (tx) => {
      const a = await createTenant(tx, 'A');
      const b = await createTenant(tx, 'B');
      await tx`insert into storage.objects (bucket_id, name) values ('tenant-files', ${`${b}/member/y/secret.pdf`})`;
      const viewer = await uploader(tx, a, ['files.view']);
      await asUser(tx, { sub: viewer, tenant_id: a }, async () => {
        expect((await tx`select name from storage.objects where bucket_id = 'tenant-files'`).length).toBe(0);
        await expectDbError(tx, /row-level security/, () => putObject(tx, `${a}/member/x/3.pdf`));
      });
    });
  });

  it('isolates attachment rows and requires files.view to list them', async () => {
    await withAdmin(async (tx) => {
      const a = await createTenant(tx, 'A');
      const b = await createTenant(tx, 'B');
      const add = (t: string) => tx`insert into attachments (tenant_id, entity, entity_id, object_path, file_name, mime_type, size_bytes, sha256)
        values (${t}, 'member', gen_random_uuid(), ${`${t}/member/x/${crypto.randomUUID()}-a.pdf`}, 'a.pdf', 'application/pdf', 1, 'x')`;
      await add(a);
      await add(b);
      const viewer = await uploader(tx, a);
      const noPerm = await userInTenant(tx, a);
      await asUser(tx, { sub: viewer, tenant_id: a }, async () => {
        const rows = await tx`select tenant_id from attachments`;
        expect(rows.map((r) => r.tenant_id)).toEqual([a]);
        await expectDbError(tx, /row-level security/, () => add(b));
      });
      await asUser(tx, { sub: noPerm, tenant_id: a }, async () => {
        expect((await tx`select 1 from attachments`).length).toBe(0);
      });
    });
  });
});
