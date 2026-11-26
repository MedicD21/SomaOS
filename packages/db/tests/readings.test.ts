import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { createMember, createOrgUnit, createRole, createTenant, grantRole, userInTenant } from './helpers';

afterAll(closeTestDb);

async function person(tx: Tx, t: string, perms: string[] = [], scope?: Parameters<typeof grantRole>[4], names?: [string, string]) {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u, first: names?.[0], last: names?.[1] });
  if (perms.length) await grantRole(tx, t, m, await createRole(tx, t, `r_${m.slice(0, 6)}`, perms), scope);
  return { u, m };
}

const MEMBER_PERMS = ['sog.acknowledge', 'documents.view', 'files.view'];

async function world(tx: Tx) {
  const t = await createTenant(tx);
  const s1 = await createOrgUnit(tx, t, 'Station 1');
  const s2 = await createOrgUnit(tx, t, 'Station 2');
  const chief = await person(tx, t, ['documents.manage', 'documents.publish', 'documents.view', 'sog.assign', 'sog.report', 'sog.acknowledge', 'files.view']);
  const a = await person(tx, t, MEMBER_PERMS, undefined, ['Ann', 'Alpha']);       // Station 1
  const b = await person(tx, t, MEMBER_PERMS, undefined, ['Bob', 'Bravo']);       // Station 2
  const officer1 = await person(tx, t, ['sog.report', 'documents.view'], { scopeKind: 'org_unit', orgUnitId: s1 });
  const noAck = await person(tx, t, ['documents.view']);
  for (const [m, unit] of [[a.m, s1], [b.m, s2], [officer1.m, s1]] as const) {
    await tx`insert into member_assignments (tenant_id, member_id, org_unit_id, effective) values (${t}, ${m}, ${unit}, '[2020-01-01,)')`;
  }
  return { t, s1, s2, chief, a, b, officer1, noAck };
}

const as = <T>(tx: Tx, w: { t: string }, who: { u: string }, fn: () => Promise<T>) => asUser(tx, { sub: who.u, tenant_id: w.t }, fn);
const one = async <R extends Record<string, unknown>>(rows: Promise<R[]>): Promise<R> => (await rows)[0]!;

/** A published document version, built as a superuser (the document module has its own tests). */
async function publishedDoc(tx: Tx, t: string, opts: { ack?: boolean; label?: string; doc?: string; major?: boolean } = {}) {
  let doc: string = opts.doc ?? '';
  if (!doc) {
    const [f] = await tx<{ id: string }[]>`insert into document_folders (tenant_id, name) values (${t}, ${'F' + crypto.randomUUID().slice(0, 5)}) returning id`;
    doc = (await tx<{ id: string }[]>`insert into documents (tenant_id, folder_id, kind, title, requires_ack) values (${t}, ${f!.id}, 'sog', 'Vehicle Fires', ${opts.ack ?? true}) returning id`)[0]!.id;
  }
  const vid = crypto.randomUUID();
  const [att] = await tx<{ id: string }[]>`
    insert into attachments (tenant_id, entity, entity_id, object_path, file_name, mime_type, size_bytes, sha256)
    values (${t}, 'document_version', ${vid}, ${`${t}/document_version/${vid}/x.pdf`}, 'x.pdf', 'application/pdf', 1, 'a') returning id`;
  const n = (await tx<{ n: number }[]>`select coalesce(max(version_no), 0) + 1 as n from document_versions where document_id = ${doc}`)[0]!.n;
  await tx`insert into document_versions (id, tenant_id, document_id, version_no, label, attachment_id) values (${vid}, ${t}, ${doc}, ${n}, ${opts.label ?? '1.0'}, ${att!.id})`;
  return { doc, version: vid };
}

async function assign(tx: Tx, w: Awaited<ReturnType<typeof world>>, version: string, audience: object = { all: true }, due: string | null = null, typed = false) {
  let id = '';
  await as(tx, w, w.chief, async () => {
    id = (await one(tx<{ id: string }[]>`select app.assign_reading(${version}, ${tx.json(audience as never)}, ${due}, null, ${typed}) as id`)).id;
  });
  return id;
}

describe('assigning required reading', () => {
  it('needs sog.assign, a published version and a real audience', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const { version } = await publishedDoc(tx, w.t);
      await as(tx, w, w.a, async () => {
        await expectDbError(tx, /sog\.assign required/, () => tx`select app.assign_reading(${version}, '{"all": true}'::jsonb, null, null, false)`);
      });
      await as(tx, w, w.chief, async () => {
        await expectDbError(tx, /Only a published version/, () => tx`select app.assign_reading(${version}, '{"all": true}'::jsonb, null, null, false)`);
      });
      await tx`update document_versions set status = 'published', effective_from = current_date, published_at = now() where id = ${version}`;
      await as(tx, w, w.chief, async () => {
        await expectDbError(tx, /Choose who should read it/, () => tx`select app.assign_reading(${version}, '{}'::jsonb, null, null, false)`);
        await expectDbError(tx, /No active members match/, () => tx`select app.assign_reading(${version}, ${tx.json({ role_ids: [crypto.randomUUID()] })}, null, null, false)`);
        await expectDbError(tx, /cannot be in the past/, () => tx`select app.assign_reading(${version}, '{"all": true}'::jsonb, '2020-01-01', null, false)`);
        const id = (await one(tx<{ id: string }[]>`select app.assign_reading(${version}, '{"all": true}'::jsonb, null, null, false) as id`)).id;
        expect(id).toBeTruthy();
        await expectDbError(tx, /already has an open reading/, () => tx`select app.assign_reading(${version}, '{"all": true}'::jsonb, null, null, false)`);
      });
    });
  });

  it('a unit audience includes only active members of that unit and its sub-units; separated members are skipped', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const sub = await createOrgUnit(tx, w.t, 'Engine 1', w.s1);
      const c = await person(tx, w.t, MEMBER_PERMS);
      await tx`insert into member_assignments (tenant_id, member_id, org_unit_id, effective) values (${w.t}, ${c.m}, ${sub}, '[2020-01-01,)')`;
      const gone = await person(tx, w.t, MEMBER_PERMS);
      await tx`insert into member_assignments (tenant_id, member_id, org_unit_id, effective) values (${w.t}, ${gone.m}, ${w.s1}, '[2020-01-01,)')`;
      await tx`update members set status = 'separated', separated_on = current_date where id = ${gone.m}`;
      const { version } = await publishedDoc(tx, w.t);
      await tx`update document_versions set status = 'published', effective_from = current_date, published_at = now() where id = ${version}`;
      const reading = await assign(tx, w, version, { org_unit_ids: [w.s1] });
      const members = (await tx<{ member_id: string }[]>`select member_id from reading_assignees where reading_id = ${reading}`).map((r) => r.member_id);
      expect(members.sort()).toEqual([w.a.m, w.officer1.m, c.m].sort());
      expect(members).not.toContain(w.b.m);
      expect(members).not.toContain(gone.m);
    });
  });
});

describe('acknowledging', () => {
  async function open(tx: Tx, w: Awaited<ReturnType<typeof world>>, opts: { typed?: boolean } = {}) {
    const d = await publishedDoc(tx, w.t);
    await tx`update document_versions set status = 'published', effective_from = current_date, published_at = now() where id = ${d.version}`;
    const reading = await assign(tx, w, d.version, { all: true }, null, opts.typed);
    return { ...d, reading };
  }

  it('an assignee acknowledges once, with the statement and a hash; nobody can edit or delete it', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const r = await open(tx, w);
      await as(tx, w, w.a, async () => {
        await tx`select app.acknowledge_reading(${r.reading}, null)`;
        await expectDbError(tx, /already acknowledged/, () => tx`select app.acknowledge_reading(${r.reading}, null)`);
      });
      const [ack] = await tx<{ member_id: string; method: string; statement_text: string; ack_hash: string; version_id: string }[]>`select * from acknowledgements`;
      expect(ack).toMatchObject({ member_id: w.a.m, method: 'click', version_id: r.version });
      expect(ack!.ack_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(ack!.statement_text).toContain('read and understand');
      await expectDbError(tx, /append-only/, () => tx`update acknowledgements set method = 'typed_name'`);
      await expectDbError(tx, /append-only/, () => tx`delete from acknowledgements`);
      await as(tx, w, w.a, async () => {
        await expectDbError(tx, /permission denied/, () => tx`delete from acknowledgements`);
        await expectDbError(tx, /permission denied/, () => tx`insert into acknowledgements (tenant_id, reading_id, member_id, version_id, statement_text, method, ack_hash) values (${w.t}, ${r.reading}, ${w.b.m}, ${r.version}, 'x', 'click', 'x')`);
      });
    });
  });

  it('refuses members who are not assignees, lack the permission, or acknowledge for someone else', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const d = await publishedDoc(tx, w.t);
      await tx`update document_versions set status = 'published', effective_from = current_date, published_at = now() where id = ${d.version}`;
      const reading = await assign(tx, w, d.version, { org_unit_ids: [w.s1] });
      await as(tx, w, w.b, async () => {
        await expectDbError(tx, /not assigned to you/, () => tx`select app.acknowledge_reading(${reading}, null)`);
      });
      await as(tx, w, w.noAck, async () => {
        await expectDbError(tx, /sog\.acknowledge required/, () => tx`select app.acknowledge_reading(${reading}, null)`);
      });
      await as(tx, w, w.chief, async () => {
        await expectDbError(tx, /not assigned to you/, () => tx`select app.acknowledge_reading(${reading}, null)`);
      });
    });
  });

  it('a required typed name must match the member’s full name', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const r = await open(tx, w, { typed: true });
      await as(tx, w, w.a, async () => {
        await expectDbError(tx, /Type your full name/, () => tx`select app.acknowledge_reading(${r.reading}, null)`);
        await expectDbError(tx, /Type your full name/, () => tx`select app.acknowledge_reading(${r.reading}, 'Ann A')`);
        await tx`select app.acknowledge_reading(${r.reading}, ${'  ann ALPHA '})`;
      });
      const [ack] = await tx<{ method: string; typed_name: string }[]>`select method, typed_name from acknowledgements`;
      expect(ack).toEqual({ method: 'typed_name', typed_name: 'ann ALPHA' });
    });
  });

  it('a major version closes the old reading and opens a new one; old acknowledgements stay as history', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const r = await open(tx, w);
      await as(tx, w, w.a, async () => { await tx`select app.acknowledge_reading(${r.reading}, null)`; });
      // Publish 2.0 as a major revision through the real function.
      const v2 = await publishedDoc(tx, w.t, { doc: r.doc, label: '2.0' });
      await as(tx, w, w.chief, async () => {
        await tx`select app.publish_document_version(${v2.version}, null, true, null)`;
      });
      const readings = await tx<{ version_id: string; closed: boolean; due: string }[]>`
        select version_id, closed_at is not null as closed, due_on::text as due from required_readings where document_id = ${r.doc} order by created_at`;
      expect(readings).toHaveLength(2);
      expect(readings[0]).toMatchObject({ version_id: r.version, closed: true });
      expect(readings[1]).toMatchObject({ version_id: v2.version, closed: false });
      // Same audience, nobody has acknowledged the new one; the old acknowledgement is still there.
      expect((await tx`select 1 from reading_assignees where reading_id = (select id from required_readings where version_id = ${v2.version})`).length).toBe(5);
      expect((await tx`select 1 from acknowledgements`).length).toBe(1);
      const newReading = (await one(tx<{ id: string }[]>`select id from required_readings where version_id = ${v2.version}`)).id;
      await as(tx, w, w.a, async () => {
        await tx`select app.acknowledge_reading(${newReading}, null)`;
      });
      await as(tx, w, w.b, async () => {
        await expectDbError(tx, /closed/, () => tx`select app.acknowledge_reading(${r.reading}, null)`);
      });
      expect((await tx`select 1 from acknowledgements`).length).toBe(2);
    });
  });

  it('a minor version keeps the open reading: members acknowledge the version now in force', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const r = await open(tx, w);
      const v2 = await publishedDoc(tx, w.t, { doc: r.doc, label: '1.1' });
      await as(tx, w, w.chief, async () => { await tx`select app.publish_document_version(${v2.version}, null, false, null)`; });
      expect((await tx`select 1 from required_readings where document_id = ${r.doc}`).length).toBe(1);
      await as(tx, w, w.a, async () => { await tx`select app.acknowledge_reading(${r.reading}, null)`; });
      expect((await one(tx<{ version_id: string }[]>`select version_id from acknowledgements`)).version_id).toBe(v2.version);
    });
  });
});

describe('who can see readings', () => {
  it('a member sees only their own rows; a unit officer their unit; the chief everyone', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const d = await publishedDoc(tx, w.t);
      await tx`update document_versions set status = 'published', effective_from = current_date, published_at = now() where id = ${d.version}`;
      const reading = await assign(tx, w, d.version);
      await as(tx, w, w.a, async () => { await tx`select app.acknowledge_reading(${reading}, null)`; });
      await as(tx, w, w.b, async () => { await tx`select app.acknowledge_reading(${reading}, null)`; });
      const assignees = (who: { u: string }) => as(tx, w, who, async () => (await tx<{ member_id: string }[]>`select member_id from reading_assignees`).map((r) => r.member_id));
      const acks = (who: { u: string }) => as(tx, w, who, async () => (await tx`select 1 from acknowledgements`).length);
      expect(await assignees(w.a)).toEqual([w.a.m]);
      expect((await assignees(w.officer1)).sort()).toEqual([w.a.m, w.officer1.m].sort());
      expect((await assignees(w.chief)).length).toBe(5);
      expect(await acks(w.a)).toBe(1);
      expect(await acks(w.officer1)).toBe(1);   // Ann (Station 1) only, not Bob
      expect(await acks(w.chief)).toBe(2);
      expect(await acks(w.noAck)).toBe(0);
      const status = await as(tx, w, w.officer1, async () => tx<{ member_id: string; acknowledged_at: string | null }[]>`select member_id, acknowledged_at from reading_status`);
      expect(status.map((s) => s.member_id).sort()).toEqual([w.a.m, w.officer1.m].sort());
    });
  });

  it('is tenant isolated', async () => {
    await withAdmin(async (tx) => {
      const a = await world(tx);
      const b = await world(tx);
      const d = await publishedDoc(tx, a.t);
      await tx`update document_versions set status = 'published', effective_from = current_date, published_at = now() where id = ${d.version}`;
      await assign(tx, a, d.version);
      await as(tx, b, b.chief, async () => {
        for (const table of ['required_readings', 'reading_assignees', 'acknowledgements']) {
          expect((await tx`select 1 from ${tx(table)}`).length, table).toBe(0);
        }
        expect((await tx`select 1 from reading_reminders`).length).toBe(0);
      });
    });
  });
});

describe('reminders', () => {
  async function reading(tx: Tx, w: Awaited<ReturnType<typeof world>>, dueOffset: number, withAssignedLogged = true) {
    const d = await publishedDoc(tx, w.t);
    await tx`update document_versions set status = 'published', effective_from = current_date, published_at = now() where id = ${d.version}`;
    const [today] = await tx<{ d: string }[]>`select (now() at time zone timezone)::date::text as d from tenants where id = ${w.t}`;
    const [r] = await tx<{ id: string }[]>`
      insert into required_readings (tenant_id, document_id, version_id, audience, due_on, statement)
      values (${w.t}, ${d.doc}, ${d.version}, '{"all": true}', ${today!.d}::date + ${dueOffset}::int, 'I have read and understand this.') returning id`;
    await tx`insert into reading_assignees (tenant_id, reading_id, member_id) select ${w.t}, ${r!.id}, id from members where tenant_id = ${w.t}`;
    if (withAssignedLogged) {
      await tx`insert into reading_reminders (tenant_id, reading_id, member_id, sent_on, kind)
               select ${w.t}, ${r!.id}, id, ${today!.d}::date - 1, 'assigned' from members where tenant_id = ${w.t}`;
    }
    return r!.id;
  }

  const send = async (tx: Tx) => (await one(tx<{ n: number }[]>`select app.send_reading_reminders() as n`)).n;

  it('sends at assignment, 7 days before, on the due date and weekly when overdue, never twice in a day', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const members = 5;
      const id7 = await reading(tx, w, 7);
      expect(await send(tx)).toBe(members);               // before_7
      expect(await send(tx)).toBe(0);                     // same day rerun: nothing new
      expect((await tx`select 1 from reading_reminders where reading_id = ${id7} and kind = 'before_7'`).length).toBe(members);
      expect((await tx`select 1 from notifications where tenant_id = ${w.t} and kind = 'reading-reminder'`).length).toBe(members);

      const w2 = await world(tx);
      await reading(tx, w2, 0);
      expect(await send(tx)).toBe(members);               // due today
      expect(await send(tx)).toBe(0);

      const w3 = await world(tx);
      const over = await reading(tx, w3, -3);
      expect(await send(tx)).toBe(members);               // overdue
      expect(await send(tx)).toBe(0);                     // not again the same day
      const rows = await tx<{ kind: string }[]>`select distinct kind from reading_reminders where reading_id = ${over}`;
      expect(rows.map((r) => r.kind).sort()).toEqual(['assigned', 'overdue']);

      const w4 = await world(tx);
      await reading(tx, w4, 3);                           // 3 days left: no reminder today
      expect(await send(tx)).toBe(0);
    });
  });

  it('skips acknowledged and separated members, and honours notification preferences for email', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const id = await reading(tx, w, 0);
      await tx`insert into acknowledgements (tenant_id, reading_id, member_id, version_id, statement_text, method, ack_hash)
               select ${w.t}, ${id}, ${w.a.m}, version_id, 'x', 'click', 'h' from required_readings where id = ${id}`;
      await tx`update members set status = 'separated', separated_on = current_date where id = ${w.b.m}`;
      await tx`insert into notification_prefs (tenant_id, member_id, kind, channels) values (${w.t}, ${w.officer1.m}, 'reading-reminder', array['in_app'])`;
      await tx`delete from jobs`;
      const n = await send(tx);
      expect(n).toBe(3);                                  // 5 members - acknowledged - separated
      const notified = (await tx<{ member_id: string }[]>`select member_id from notifications where kind = 'reading-reminder' and tenant_id = ${w.t}`).map((r) => r.member_id);
      expect(notified).not.toContain(w.a.m);
      expect(notified).not.toContain(w.b.m);
      expect(notified).toContain(w.officer1.m);
      const emails = await tx<{ payload: { to: string } }[]>`select payload from jobs where kind = 'send-email' and payload->>'subject' like 'Required reading due today%'`;
      expect(emails.length).toBe(2);                      // officer1 opted out of email
    });
  });

  it('a department-wide sog.assign holder may run it for their department; others may not', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await reading(tx, w, 0);
      await as(tx, w, w.a, async () => {
        await expectDbError(tx, /sog\.assign required/, () => tx`select app.send_reading_reminders()`);
      });
      const n = await as(tx, w, w.chief, async () => (await one(tx<{ n: number }[]>`select app.send_reading_reminders() as n`)).n);
      expect(n).toBe(5);
    });
  });

  it('adds members who joined the audience later', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const id = await reading(tx, w, 0);
      const late = await person(tx, w.t, MEMBER_PERMS);
      await send(tx);
      expect((await tx`select 1 from reading_assignees where reading_id = ${id} and member_id = ${late.m}`).length).toBe(1);
    });
  });
});
