import { afterAll, describe, expect, it } from 'vitest';
import { asUser, closeTestDb, withAdmin, type Tx } from '@soma/db/src/test-harness';
import { loadDocument, loadLibrary } from '@/server/documents/load';
import { loadMyReadings, loadReadingReport } from '@/server/documents/readings';
import { friendlyDbError } from '@/server/actions';
import { loadPublishedForm, loadPublishedForms, loadSubmission, loadSubmissions } from '@/server/forms/load';

afterAll(() => closeTestDb());

type Demo = { tenantId: string; adminId: string; memberUserId: string };

async function demo(tx: Tx): Promise<Demo> {
  const [row] = await tx<Demo[]>`
    select t.id as "tenantId", a.id as "adminId", u.id as "memberUserId"
    from tenants t, auth.users a, auth.users u
    where t.slug = 'demo-fire-rescue' and a.email = 'admin@soma.local' and u.email = 'member@soma.local'`;
  if (!row) throw new Error('Demo Fire Rescue is not seeded; run supabase db reset && pnpm db:seed');
  return row;
}

const asAdmin = <T>(tx: Tx, d: Demo, fn: () => Promise<T>): Promise<T> => asUser(tx, { sub: d.adminId, tenant_id: d.tenantId }, fn);
const asMember = <T>(tx: Tx, d: Demo, fn: () => Promise<T>): Promise<T> => asUser(tx, { sub: d.memberUserId, tenant_id: d.tenantId }, fn);

/** A draft version for a document, with its file recorded the way the files module does. */
async function draft(tx: Tx, d: Demo, doc: string, label: string): Promise<string> {
  const vid = crypto.randomUUID();
  const [adminUser] = await tx<{ id: string }[]>`select ${d.adminId}::uuid as id`;
  const [a] = await tx<{ id: string }[]>`
    insert into attachments (tenant_id, entity, entity_id, object_path, file_name, mime_type, size_bytes, sha256, uploaded_by)
    values (${d.tenantId}, 'document_version', ${vid}, ${`${d.tenantId}/document_version/${vid}/x.pdf`}, 'x.pdf', 'application/pdf', 5, 'a', ${adminUser!.id}) returning id`;
  await asAdmin(tx, d, async () => { await tx`select app.add_document_version(${doc}, ${a!.id}, ${label}, 'note')`; });
  return vid;
}

describe('documents, readings and forms through the web loaders', () => {
  it('the library hides restricted folders from a member, and a published SOG reaches them with its file link', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      let doc = '';
      await asAdmin(tx, d, async () => {
        const [f] = await tx<{ id: string }[]>`select id from document_folders where name = 'Policies and SOGs'`;
        doc = (await tx<{ id: string }[]>`select app.create_document(${f!.id}, 'sog', 'Vehicle Fires', 'SOG 3.4', true) as id`)[0]!.id;
      });
      const v = await draft(tx, d, doc, '1.0');
      await asAdmin(tx, d, async () => { await tx`select app.publish_document_version(${v}, null, false, null)`; });

      const admin = await asAdmin(tx, d, () => loadLibrary(tx));
      expect(admin.folders.map((f) => f.name)).toContain('HR');
      const member = await asMember(tx, d, () => loadLibrary(tx));
      expect(member.folders.map((f) => f.name)).not.toContain('HR');
      const sog = member.docs.find((x) => x.id === doc)!;
      expect(sog).toMatchObject({ title: 'Vehicle Fires', number: 'SOG 3.4', label: '1.0', requiresAck: true });
      expect(sog.attachmentId).toBeTruthy();

      const detail = await asMember(tx, d, () => loadDocument(tx, doc));
      expect(detail!.versions.map((x) => x.status)).toEqual(['published']);
    });
  });

  it('assign, acknowledge and report: the member sees their reading, the admin sees the status', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      let doc = '';
      await asAdmin(tx, d, async () => {
        const [f] = await tx<{ id: string }[]>`select id from document_folders where name = 'Policies and SOGs'`;
        doc = (await tx<{ id: string }[]>`select app.create_document(${f!.id}, 'sog', 'Water Rescue', null, true) as id`)[0]!.id;
      });
      const v = await draft(tx, d, doc, '1.0');
      await asAdmin(tx, d, async () => {
        await tx`select app.publish_document_version(${v}, null, false, null)`;
        await tx`select app.assign_reading(${v}, '{"all": true}'::jsonb, null, null, false)`;
      });
      const mine = await asMember(tx, d, () => loadMyReadings(tx));
      const reading = mine.find((r) => r.title === 'Water Rescue')!;
      expect(reading).toMatchObject({ versionLabel: '1.0', acknowledgedAt: null, closed: false, overdue: false });
      expect(reading.attachmentId).toBeTruthy();

      await asMember(tx, d, async () => { await tx`select app.acknowledge_reading(${reading.readingId}, null)`; });
      const after = (await asMember(tx, d, () => loadMyReadings(tx))).find((r) => r.title === 'Water Rescue')!;
      expect(after.acknowledgedAt).toBeInstanceOf(Date);

      const report = (await asAdmin(tx, d, () => loadReadingReport(tx))).find((r) => r.title === 'Water Rescue')!;
      expect(report.acknowledged).toBe(1);
      expect(report.assigned).toBeGreaterThanOrEqual(2);
      expect(report.waiting.length).toBe(report.assigned - 1);
      expect(report.waiting).not.toContain('Medic, Riley');
    });
  });

  it('starter forms are published for members; a signed submission verifies, and the officer sees and decides it', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      const forms = await asMember(tx, d, () => loadPublishedForms(tx));
      expect(forms.map((f) => f.key)).toEqual(expect.arrayContaining(['incident_injury_report', 'vehicle_damage_report', 'equipment_issue_receipt']));
      const def = (await asMember(tx, d, () => loadPublishedForm(tx, 'incident_injury_report')))!;
      expect(def).toMatchObject({ approval: 'officer', requiresSignature: true });

      let id = '';
      await asMember(tx, d, async () => {
        id = (await tx<{ id: string }[]>`
          select app.submit_form(${def.id}, ${tx.json({ incident_date: '2026-11-01', location: 'Station 1 ramp', what_happened: 'Slipped', injured: false, supervisor_notified: true })},
                                 ${tx.json({ method: 'typed', typed_name: 'Riley Medic' })}, null, '203.0.113.5', 'Vitest') as id`)[0]!.id;
      });
      const asSubmitter = await asMember(tx, d, () => loadSubmission(tx, id));
      expect(asSubmitter).toMatchObject({ status: 'submitted', mine: true, canDecide: false, verified: { ok: true } });
      expect(asSubmitter!.signatures[0]).toMatchObject({ method: 'typed', signerName: 'Riley Medic' });

      const pending = await asAdmin(tx, d, () => loadSubmissions(tx, 'pending'));
      expect(pending.map((s) => s.id)).toContain(id);
      expect((await asAdmin(tx, d, () => loadSubmission(tx, id)))!.canDecide).toBe(true);
      await asAdmin(tx, d, async () => { await tx`select app.decide_form(${id}, 'approved', null)`; });
      expect((await asMember(tx, d, () => loadSubmission(tx, id)))!.status).toBe('approved');
      expect((await asMember(tx, d, () => loadSubmissions(tx, 'mine'))).map((s) => s.id)).toContain(id);
    });
  });
});

describe('friendlyDbError for documents and forms', () => {
  it.each([
    ['Injury details is required', 'Injury details is required'],
    ['What happened must be one of: a, b', 'What happened must be one of: a, b'],
    ['You have already acknowledged this reading', 'You have already acknowledged this reading'],
    ['A newer version was published; read that instead', 'A newer version was published; read that instead'],
    ['Type your full name exactly as it appears on your member record to sign', 'Type your full name exactly as it appears on your member record to sign'],
    ['This form must be signed', 'This form must be signed'],
    ['not allowed: documents.manage required', 'Not allowed: documents.manage required'],
    ['That document is archived', 'That document is archived'],
    ['not in your scope: you cannot decide your own submission', 'Not in your scope: you cannot decide your own submission'],
  ])('passes %j through', (message, shown) => {
    expect(friendlyDbError(new Error(message))).toBe(shown);
  });
});
