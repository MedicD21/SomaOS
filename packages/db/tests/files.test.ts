import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { addCredential, createCredentialType, createMember, createRole, createTenant, grantRole, userInTenant } from './helpers';

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

describe('sensitive (HR) credential documents', () => {
  async function person(tx: Tx, t: string, perms: string[]) {
    const u = await userInTenant(tx, t);
    const m = await createMember(tx, t, { userId: u });
    await grantRole(tx, t, m, await createRole(tx, t, `p_${m.slice(0, 8)}`, perms));
    return { u, m };
  }

  it('are visible only to the credential owner and credentials.view holders', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx, 'A');
      const owner = await person(tx, t, ['files.view']);
      const plain = await person(tx, t, ['files.view', 'files.upload', 'admin.members.view']);
      const hr = await person(tx, t, ['files.view', 'credentials.view']);
      const cred = await addCredential(tx, t, owner.m, await createCredentialType(tx, t, 'hazmat', { kind: 'none' }), null);
      const path = `${t}/member_credential/${cred}/${crypto.randomUUID()}-card.pdf`;
      await tx`insert into storage.objects (bucket_id, name) values ('tenant-files', ${path})`;
      await tx`insert into attachments (tenant_id, entity, entity_id, object_path, file_name, mime_type, size_bytes, sha256, sensitivity)
               values (${t}, 'member_credential', ${cred}, ${path}, 'card.pdf', 'application/pdf', 1, 'x', 'HR')`;
      const sees = async (u: string) =>
        asUser(tx, { sub: u, tenant_id: t }, async () => ({
          row: (await tx`select 1 from attachments where object_path = ${path}`).length,
          object: (await tx`select 1 from storage.objects where name = ${path}`).length,
        }));
      expect(await sees(plain.u)).toEqual({ row: 0, object: 0 });
      expect(await sees(owner.u)).toEqual({ row: 1, object: 1 });
      expect(await sees(hr.u)).toEqual({ row: 1, object: 1 });
    });
  });

  it('keep ordinary attachments and in-flight uploads readable', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx, 'A');
      const up = await person(tx, t, ['files.view', 'files.upload']);
      const other = await person(tx, t, ['files.view']);
      const path = `${t}/member/${up.m}/${crypto.randomUUID()}-a.pdf`;
      await asUser(tx, { sub: up.u, tenant_id: t }, async () => {
        // The storage API reads the object back right after inserting it, before the attachments row exists.
        const [o] = await tx`insert into storage.objects (bucket_id, name, owner_id) values ('tenant-files', ${path}, auth.uid()::text) returning name`;
        expect(o!.name).toBe(path);
      });
      expect(await asUser(tx, { sub: other.u, tenant_id: t }, async () => (await tx`select 1 from storage.objects where name = ${path}`).length)).toBe(0);
      await tx`insert into attachments (tenant_id, entity, entity_id, object_path, file_name, mime_type, size_bytes, sha256)
               values (${t}, 'member', ${up.m}, ${path}, 'a.pdf', 'application/pdf', 1, 'x')`;
      expect(await asUser(tx, { sub: other.u, tenant_id: t }, async () => (await tx`select 1 from storage.objects where name = ${path}`).length)).toBe(1);
    });
  });
});
