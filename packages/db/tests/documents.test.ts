import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { createMember, createRole, createTenant, grantRole, userInTenant } from './helpers';

afterAll(closeTestDb);

async function person(tx: Tx, t: string, perms: string[] = []) {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u });
  if (perms.length) await grantRole(tx, t, m, await createRole(tx, t, `r_${m.slice(0, 6)}`, perms));
  return { u, m };
}

/** An uploaded file for a (future) document version, as the files module records it. */
async function file(tx: Tx, t: string, uploader: string | null = null): Promise<{ id: string; versionId: string }> {
  const versionId = crypto.randomUUID();
  const [a] = await tx<{ id: string }[]>`
    insert into attachments (tenant_id, entity, entity_id, object_path, file_name, mime_type, size_bytes, sha256, uploaded_by)
    values (${t}, 'document_version', ${versionId}, ${`${t}/document_version/${versionId}/${crypto.randomUUID()}-x.pdf`}, 'x.pdf',
            'application/pdf', 10, 'abc', ${uploader}) returning id`;
  return { id: a!.id, versionId };
}

async function world(tx: Tx) {
  const t = await createTenant(tx);
  const chief = await person(tx, t, ['documents.manage', 'documents.publish', 'documents.backdate', 'documents.view', 'files.view', 'files.upload']);
  const publisherNoBackdate = await person(tx, t, ['documents.manage', 'documents.publish', 'documents.view', 'files.view']);
  const member = await person(tx, t, ['documents.view', 'files.view']);
  const outsider = await person(tx, t, []);
  return { t, chief, publisherNoBackdate, member, outsider };
}

const as = <T>(tx: Tx, w: { t: string }, who: { u: string }, fn: () => Promise<T>) => asUser(tx, { sub: who.u, tenant_id: w.t }, fn);
const one = async <R extends Record<string, unknown>>(rows: Promise<R[]>): Promise<R> => (await rows)[0]!;

async function folderAndDoc(tx: Tx, w: Awaited<ReturnType<typeof world>>, opts: { perm?: string | null; ack?: boolean } = {}) {
  let folder = '';
  let doc = '';
  await as(tx, w, w.chief, async () => {
    folder = (await one(tx<{ id: string }[]>`select app.save_folder(null, null, ${'Folder ' + crypto.randomUUID().slice(0, 4)}, ${opts.perm ?? null}) as id`)).id;
    doc = (await one(tx<{ id: string }[]>`select app.create_document(${folder}, 'sog', 'Vehicle Fires', ${'SOG-' + crypto.randomUUID().slice(0, 4)}, ${opts.ack ?? false}) as id`)).id;
  });
  return { folder, doc };
}

async function draft(tx: Tx, w: Awaited<ReturnType<typeof world>>, doc: string, label: string): Promise<string> {
  const f = await file(tx, w.t, w.chief.u);
  let id = '';
  await as(tx, w, w.chief, async () => {
    id = (await one(tx<{ id: string }[]>`select app.add_document_version(${doc}, ${f.id}, ${label}, 'note') as id`)).id;
  });
  return id;
}

describe('folders and visibility', () => {
  it('a restricted folder (and its sub-folders and documents) is hidden from members without the permission', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const hr = await person(tx, w.t, ['documents.view', 'admin.members.view']);
      let restricted = '';
      let sub = '';
      await as(tx, w, w.chief, async () => {
        restricted = (await one(tx<{ id: string }[]>`select app.save_folder(null, null, 'HR', 'admin.members.view') as id`)).id;
        sub = (await one(tx<{ id: string }[]>`select app.save_folder(null, ${restricted}, 'Discipline', null) as id`)).id;
      });
      const { doc } = await folderAndDoc(tx, w);
      await as(tx, w, w.chief, async () => {
        await tx`select app.create_document(${sub}, 'document', 'Grievance Process', null, false)`;
      });
      const names = (who: { u: string }) => as(tx, w, who, async () => (await tx<{ name: string }[]>`select name from document_folders order by name`).map((r) => r.name));
      expect(await names(w.member)).not.toContain('HR');
      expect(await names(w.member)).not.toContain('Discipline');
      expect(await names(w.outsider)).toEqual([]);                      // documents.view is required at all
      expect(await names(hr)).toEqual(expect.arrayContaining(['HR', 'Discipline']));
      expect(await names(w.chief)).toEqual(expect.arrayContaining(['HR', 'Discipline']));
      const titles = (who: { u: string }) => as(tx, w, who, async () => (await tx<{ title: string }[]>`select title from documents`).map((r) => r.title));
      expect(await titles(w.member)).toEqual(['Vehicle Fires']);
      expect(await titles(hr)).toContain('Grievance Process');
      expect(doc).toBeTruthy();
    });
  });

  it('refuses a folder cycle, duplicate sibling names, and non-managers', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.chief, async () => {
        const a = (await one(tx<{ id: string }[]>`select app.save_folder(null, null, 'A', null) as id`)).id;
        const b = (await one(tx<{ id: string }[]>`select app.save_folder(null, ${a}, 'B', null) as id`)).id;
        await expectDbError(tx, /moved under itself/, () => tx`select app.save_folder(${a}, ${b}, 'A', null)`);
        await expectDbError(tx, /document_folders_name_key/, () => tx`select app.save_folder(null, ${a}, 'b', null)`);
      });
      await as(tx, w, w.member, async () => {
        await expectDbError(tx, /documents\.manage required/, () => tx`select app.save_folder(null, null, 'Mine', null)`);
        await expectDbError(tx, /documents\.manage required/, () => tx`select app.create_document(null, 'document', 'x', null, false)`);
      });
    });
  });
});

describe('document versions', () => {
  it('draft versions are visible only to managers; publishing makes it visible and supersedes the old version', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const { doc } = await folderAndDoc(tx, w);
      const v1 = await draft(tx, w, doc, '1.0');
      expect(await as(tx, w, w.member, async () => (await tx`select 1 from document_versions`).length)).toBe(0);
      await as(tx, w, w.chief, async () => { await tx`select app.publish_document_version(${v1}, null, false, null)`; });
      expect(await as(tx, w, w.member, async () => (await tx`select 1 from document_versions where status = 'published'`).length)).toBe(1);

      const v2 = await draft(tx, w, doc, '2.0');
      await as(tx, w, w.chief, async () => { await tx`select app.publish_document_version(${v2}, null, false, null)`; });
      const rows = await tx<{ label: string; status: string }[]>`select label, status from document_versions where document_id = ${doc} order by version_no`;
      expect(rows).toEqual([{ label: '1.0', status: 'superseded' }, { label: '2.0', status: 'published' }]);
      // The superseded version stays readable.
      expect(await as(tx, w, w.member, async () => (await tx`select 1 from document_versions where status = 'superseded'`).length)).toBe(1);
      const cur = await as(tx, w, w.member, async () => tx<{ label: string }[]>`select label from current_documents where document_id = ${doc}`);
      expect(cur.map((c) => c.label)).toEqual(['2.0']);
    });
  });

  it('a published version cannot be edited or deleted, even by the table owner', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const { doc } = await folderAndDoc(tx, w);
      const v1 = await draft(tx, w, doc, '1.0');
      await as(tx, w, w.chief, async () => { await tx`select app.publish_document_version(${v1}, null, false, null)`; });
      await expectDbError(tx, /cannot be edited/, () => tx`update document_versions set label = '9.9' where id = ${v1}`);
      await expectDbError(tx, /cannot be changed/, () => tx`update document_versions set effective_from = '2001-01-01' where id = ${v1}`);
      await expectDbError(tx, /never deleted/, () => tx`delete from document_versions where id = ${v1}`);
      await as(tx, w, w.chief, async () => {
        await expectDbError(tx, /permission denied/, () => tx`update document_versions set label = '9.9'`);
      });
    });
  });

  it('only documents.publish publishes; backdating needs documents.backdate and a reason', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const { doc } = await folderAndDoc(tx, w);
      const v1 = await draft(tx, w, doc, '1.0');
      await as(tx, w, w.member, async () => {
        await expectDbError(tx, /documents\.publish required/, () => tx`select app.publish_document_version(${v1}, null, false, null)`);
      });
      await as(tx, w, w.publisherNoBackdate, async () => {
        await expectDbError(tx, /documents\.backdate required/, () => tx`select app.publish_document_version(${v1}, '2020-01-01', false, 'Back dated')`);
      });
      await as(tx, w, w.chief, async () => {
        await expectDbError(tx, /at least 5 characters/, () => tx`select app.publish_document_version(${v1}, '2020-01-01', false, 'no')`);
        await tx`select app.publish_document_version(${v1}, '2020-01-01', false, 'Adopted by the board in 2020')`;
        await expectDbError(tx, /Only a draft version/, () => tx`select app.publish_document_version(${v1}, null, false, null)`);
      });
    });
  });

  it('an archived document refuses new versions; another department’s file is refused', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const other = await createTenant(tx, 'Other FD');
      const { doc } = await folderAndDoc(tx, w);
      const foreign = await file(tx, other);
      const own = await file(tx, w.t, w.chief.u);
      const spare = await file(tx, w.t, w.chief.u);
      await as(tx, w, w.chief, async () => {
        await expectDbError(tx, /Upload the file first/, () => tx`select app.add_document_version(${doc}, ${foreign.id}, '1.0', null)`);
        await tx`select app.add_document_version(${doc}, ${own.id}, '1.0', null)`;
        await expectDbError(tx, /already used/, () => tx`select app.add_document_version(${doc}, ${own.id}, '1.1', null)`);
        await expectDbError(tx, /at least 5 characters/, () => tx`select app.archive_document(${doc}, 'no')`);
        await tx`select app.archive_document(${doc}, 'Replaced by the new policy')`;
        await expectDbError(tx, /archived/, () => tx`select app.add_document_version(${doc}, ${spare.id}, '2.0', null)`);
      });
    });
  });

  it('concurrent publishes of two drafts leave exactly one published version', async () => {
    const sql = postgres(process.env.SOMA_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 4, onnotice: () => undefined });
    const t = (await sql<{ id: string }[]>`select app.create_tenant('Race FD', ${'race-' + crypto.randomUUID().slice(0, 8)}, 'America/Chicago', 'career', 'TX') as id`)[0]!.id;
    try {
      const u = (await sql<{ id: string }[]>`
        insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
        values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${`race-${crypto.randomUUID()}@test.local`}, '{}', '{}', now(), now()) returning id`)[0]!.id;
      await sql`insert into memberships (tenant_id, user_id, status) values (${t}, ${u}, 'active')`;
      const m = (await sql<{ id: string }[]>`insert into members (tenant_id, user_id, first_name, last_name, employment_type) values (${t}, ${u}, 'A', 'B', 'career_full_time') returning id`)[0]!.id;
      const role = (await sql<{ id: string }[]>`insert into roles (tenant_id, key, label) values (${t}, 'r', 'r') returning id`)[0]!.id;
      for (const p of ['documents.manage', 'documents.publish']) await sql`insert into role_permissions (tenant_id, role_id, permission) values (${t}, ${role}, ${p})`;
      await sql`insert into role_grants (tenant_id, member_id, role_id, scope_kind, valid) values (${t}, ${m}, ${role}, 'department', '[2026-01-01,)')`;
      const folder = (await sql<{ id: string }[]>`insert into document_folders (tenant_id, name) values (${t}, 'F') returning id`)[0]!.id;
      const doc = (await sql<{ id: string }[]>`insert into documents (tenant_id, folder_id, title) values (${t}, ${folder}, 'D') returning id`)[0]!.id;
      const versions: string[] = [];
      for (const n of [1, 2]) {
        const vid = crypto.randomUUID();
        const a = (await sql<{ id: string }[]>`
          insert into attachments (tenant_id, entity, entity_id, object_path, file_name, mime_type, size_bytes, sha256)
          values (${t}, 'document_version', ${vid}, ${`${t}/document_version/${vid}/x.pdf`}, 'x.pdf', 'application/pdf', 1, 'a') returning id`)[0]!.id;
        await sql`insert into document_versions (id, tenant_id, document_id, version_no, label, attachment_id) values (${vid}, ${t}, ${doc}, ${n}, ${String(n)}, ${a})`;
        versions.push(vid);
      }
      const publish = (vid: string) => sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ role: 'authenticated', sub: u, tenant_id: t })}, true)`;
        await tx`set local role authenticated`;
        await tx`select app.publish_document_version(${vid}, null, false, null)`;
      });
      const results = await Promise.allSettled(versions.map(publish));
      expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
      const published = await sql`select 1 from document_versions where document_id = ${doc} and status = 'published'`;
      expect(published.length).toBe(1);
      const superseded = await sql`select 1 from document_versions where document_id = ${doc} and status = 'superseded'`;
      expect(published.length + superseded.length).toBe(2);
    } finally {
      await sql`delete from tenants where id = ${t}`.catch(() => undefined);
      await sql.end();
    }
  });
});

describe('document files', () => {
  it('a version’s file is visible only to those who can see the version (not every files.view holder)', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const hr = await person(tx, w.t, ['documents.view', 'files.view', 'admin.members.view']);
      const { doc } = await folderAndDoc(tx, w, { perm: 'admin.members.view' });
      const v = await draft(tx, w, doc, '1.0');
      await as(tx, w, w.chief, async () => { await tx`select app.publish_document_version(${v}, null, false, null)`; });
      const count = (who: { u: string }) => as(tx, w, who, async () => (await tx`select 1 from attachments where entity = 'document_version'`).length);
      expect(await count(w.member)).toBe(0);     // has files.view but not the HR folder
      expect(await count(hr)).toBe(1);
      expect(await count(w.chief)).toBe(1);
    });
  });

  it('a draft version’s file is hidden from members until it is published', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const { doc } = await folderAndDoc(tx, w);
      const v = await draft(tx, w, doc, '1.0');
      const count = (who: { u: string }) => as(tx, w, who, async () => (await tx`select 1 from attachments where entity = 'document_version'`).length);
      expect(await count(w.member)).toBe(0);
      expect(await count(w.chief)).toBe(1);
      await as(tx, w, w.chief, async () => { await tx`select app.publish_document_version(${v}, null, false, null)`; });
      expect(await count(w.member)).toBe(1);
    });
  });
});

describe('isolation and audit', () => {
  it('another department sees none of the folders, documents or versions', async () => {
    await withAdmin(async (tx) => {
      const a = await world(tx);
      const b = await world(tx);
      const { doc } = await folderAndDoc(tx, a);
      const v = await draft(tx, a, doc, '1.0');
      await as(tx, a, a.chief, async () => { await tx`select app.publish_document_version(${v}, null, false, null)`; });
      await as(tx, b, b.chief, async () => {
        for (const table of ['document_folders', 'documents', 'document_versions']) {
          expect((await tx`select 1 from ${tx(table)}`).length, table).toBe(0);
        }
        await expectDbError(tx, /unknown document/, () => tx`select app.archive_document(${doc}, 'Not mine to touch')`);
      });
    });
  });

  it('writes are audited', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await folderAndDoc(tx, w);
      const n = await tx`select 1 from audit_log where tenant_id = ${w.t} and table_name in ('documents', 'document_folders')`;
      expect(n.length).toBeGreaterThanOrEqual(2);
    });
  });
});
