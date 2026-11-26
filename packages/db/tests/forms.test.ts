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

const FIELDS = [
  { key: 'what', label: 'What happened', type: 'long_text', required: true },
  { key: 'injured', label: 'Anyone injured', type: 'boolean', required: true },
  { key: 'injury', label: 'Injury details', type: 'text', required: true, show_if: { field: 'injured', equals: true } },
  { key: 'severity', label: 'Severity', type: 'select', required: false, options: [{ value: 'minor', label: 'Minor' }, { value: 'major', label: 'Major' }] },
  { key: 'hours', label: 'Hours lost', type: 'integer', required: false },
];
const STATEMENT = 'I certify that this report is true and complete.';
const OK = { what: 'Slipped on the ramp', injured: false };
const PNG = 'iVBORw0KGgo'.padEnd(300, 'A');

async function world(tx: Tx) {
  const t = await createTenant(tx);
  const s1 = await createOrgUnit(tx, t, 'Station 1');
  const s2 = await createOrgUnit(tx, t, 'Station 2');
  const chief = await person(tx, t, ['forms.manage', 'forms.submit', 'forms.approve', 'forms.view_all']);
  const me = await person(tx, t, ['forms.submit'], undefined, ['Pat', 'Medic']);          // Station 1
  const other = await person(tx, t, ['forms.submit'], undefined, ['Olive', 'Other']);     // Station 2
  const officer1 = await person(tx, t, ['forms.approve'], { scopeKind: 'org_unit', orgUnitId: s1 });
  const officer2 = await person(tx, t, ['forms.approve'], { scopeKind: 'org_unit', orgUnitId: s2 });
  const viewer = await person(tx, t, ['forms.view_all']);
  const nobody = await person(tx, t, []);
  for (const [m, unit] of [[me.m, s1], [other.m, s2], [officer1.m, s1], [officer2.m, s2]] as const) {
    await tx`insert into member_assignments (tenant_id, member_id, org_unit_id, effective) values (${t}, ${m}, ${unit}, '[2020-01-01,)')`;
  }
  return { t, s1, s2, chief, me, other, officer1, officer2, viewer, nobody };
}

const as = <T>(tx: Tx, w: { t: string }, who: { u: string }, fn: () => Promise<T>) => asUser(tx, { sub: who.u, tenant_id: w.t }, fn);
const one = async <R extends Record<string, unknown>>(rows: Promise<R[]>): Promise<R> => (await rows)[0]!;

async function defineAndPublish(tx: Tx, w: Awaited<ReturnType<typeof world>>, over: { key?: string; fields?: object[]; signature?: boolean; approval?: string } = {}) {
  let id = '';
  await as(tx, w, w.chief, async () => {
    id = (await one(tx<{ id: string }[]>`
      select app.save_form_definition(${over.key ?? 'injury'}, 'Injury Report', null, ${tx.json((over.fields ?? FIELDS) as never)},
        ${over.signature ?? true}, ${over.signature === false ? null : STATEMENT}, ${over.approval ?? 'officer'}) as id`)).id;
    await tx`select app.publish_form_definition(${id})`;
  });
  return id;
}

const submit = (tx: Tx, def: string, answers: object, signature: object | null = { method: 'typed', typed_name: 'Pat Medic' }, corrects: string | null = null) =>
  one(tx<{ id: string }[]>`select app.submit_form(${def}, ${tx.json(answers as never)}, ${signature === null ? null : tx.json(signature as never)}, ${corrects}, '203.0.113.9', 'Vitest') as id`).then((r) => r.id);

describe('form definitions', () => {
  it('only forms.manage saves and publishes; fields are validated; a new version retires the old', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.me, async () => {
        await expectDbError(tx, /forms\.manage required/, () => tx`select app.save_form_definition('x', 'X', null, ${tx.json(FIELDS as never)}, false, null, 'none')`);
      });
      await as(tx, w, w.chief, async () => {
        const bad = (fields: unknown) => tx`select app.save_form_definition('bad', 'Bad', null, ${tx.json(fields as never)}, false, null, 'none')`;
        await expectDbError(tx, /not valid/, () => bad([]));
        await expectDbError(tx, /not valid/, () => bad([{ key: 'a', label: 'A', type: 'text' }, { key: 'a', label: 'B', type: 'text' }]));
        await expectDbError(tx, /not valid/, () => bad([{ key: 'a', label: 'A', type: 'photo' }]));
        await expectDbError(tx, /not valid/, () => bad([{ key: 'a', label: 'A', type: 'select' }]));
        await expectDbError(tx, /not valid/, () => bad([{ key: 'a', label: 'A', type: 'text', show_if: { field: 'later', equals: 1 } }, { key: 'later', label: 'L', type: 'text' }]));
        await expectDbError(tx, /not valid/, () => bad(Array.from({ length: 201 }, (_, i) => ({ key: `f${i}`, label: 'F', type: 'text' }))));
        await expectDbError(tx, /requires_signature|check/, () => tx`select app.save_form_definition('nosig', 'No Sig', null, ${tx.json(FIELDS as never)}, true, 'short', 'none')`);
      });
      const v1 = await defineAndPublish(tx, w);
      const v2 = await defineAndPublish(tx, w);
      const rows = await tx<{ version: number; status: string }[]>`select version, status from form_definitions where id in (${v1}, ${v2}) order by version`;
      expect(rows).toEqual([{ version: 1, status: 'retired' }, { version: 2, status: 'published' }]);
      await expectDbError(tx, /cannot be edited/, () => tx`update form_definitions set label = 'Changed' where id = ${v2}`);
      await expectDbError(tx, /never deleted/, () => tx`delete from form_definitions where id = ${v2}`);
    });
  });

  it('drafts are visible only to managers; published forms to people who can submit', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let draft = '';
      await as(tx, w, w.chief, async () => {
        draft = (await one(tx<{ id: string }[]>`select app.save_form_definition('d', 'Draft', null, ${tx.json(FIELDS as never)}, false, null, 'none') as id`)).id;
      });
      const seen = (who: { u: string }) => as(tx, w, who, async () => (await tx`select 1 from form_definitions`).length);
      expect(await seen(w.me)).toBe(0);
      expect(await seen(w.chief)).toBe(1);
      await as(tx, w, w.chief, async () => { await tx`select app.publish_form_definition(${draft})`; });
      expect(await seen(w.me)).toBe(1);
      expect(await seen(w.nobody)).toBe(0);
    });
  });
});

describe('submitting', () => {
  it('validates required, type, option and show_if rules with the custom-field messages', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const def = await defineAndPublish(tx, w, { signature: false, approval: 'none' });
      await as(tx, w, w.me, async () => {
        await expectDbError(tx, /What happened is required/, () => submit(tx, def, { injured: false }, null));
        await expectDbError(tx, /Injury details is required/, () => submit(tx, def, { what: 'x', injured: true }, null));
        await expectDbError(tx, /must be empty because it does not apply/, () => submit(tx, def, { ...OK, injury: 'Sprain' }, null));
        await expectDbError(tx, /must be one of: minor, major/, () => submit(tx, def, { ...OK, severity: 'huge' }, null));
        await expectDbError(tx, /must be a whole number/, () => submit(tx, def, { ...OK, hours: 1.5 }, null));
        await expectDbError(tx, /must be yes or no/, () => submit(tx, def, { what: 'x', injured: 'no' }, null));
        await expectDbError(tx, /Unknown field "extra"/, () => submit(tx, def, { ...OK, extra: 1 }, null));
        const id = await submit(tx, def, { what: 'Ankle', injured: true, injury: 'Sprain', severity: 'minor', hours: 3 }, null);
        expect(id).toBeTruthy();
      });
    });
  });

  it('a signature is required when the form needs one: typed must match the name, drawn needs an image', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const def = await defineAndPublish(tx, w);
      await as(tx, w, w.me, async () => {
        await expectDbError(tx, /must be signed/, () => submit(tx, def, OK, null));
        await expectDbError(tx, /Choose how to sign/, () => submit(tx, def, OK, { method: 'scribble' }));
        await expectDbError(tx, /Type your full name/, () => submit(tx, def, OK, { method: 'typed', typed_name: 'Pat M' }));
        await expectDbError(tx, /Draw your signature/, () => submit(tx, def, OK, { method: 'drawn', image_png: 'abc' }));
        await submit(tx, def, OK, { method: 'typed', typed_name: '  pat   MEDIC ' });
        await submit(tx, def, { ...OK, what: 'Second' }, { method: 'drawn', image_png: PNG });
      });
      const sigs = await tx<{ method: string; ip: string | null; signature_hash: string }[]>`select method, host(ip) as ip, signature_hash from form_signatures order by signed_at`;
      expect(sigs.map((s) => s.method)).toEqual(['typed', 'drawn']);
      expect(sigs[0]!.ip).toBe('203.0.113.9');
      expect(sigs[0]!.signature_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it('the hash verifies, and tampering with the stored answers or a signature makes it fail', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const def = await defineAndPublish(tx, w);
      let id = '';
      await as(tx, w, w.me, async () => { id = await submit(tx, def, OK); });
      const verify = () => as(tx, w, w.me, async () => one(tx<{ ok: boolean; submission_ok: boolean; signatures_ok: boolean }[]>`select * from app.verify_submission(${id})`));
      expect(await verify()).toEqual({ ok: true, submission_ok: true, signatures_ok: true });
      await tx`alter table form_submissions disable trigger append_only`;
      await tx`update form_submissions set answers = '{"what": "Nothing happened", "injured": false}' where id = ${id}`;
      await tx`alter table form_submissions enable trigger append_only`;
      expect(await verify()).toEqual({ ok: false, submission_ok: false, signatures_ok: true });
    });
  });

  it('a tampered signature fails verification', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const def = await defineAndPublish(tx, w);
      let id = '';
      await as(tx, w, w.me, async () => { id = await submit(tx, def, OK); });
      await tx`alter table form_signatures disable trigger append_only`;
      await tx`update form_signatures set typed_name = 'Someone Else', statement_text = 'Different text entirely here' where submission_id = ${id}`;
      await tx`alter table form_signatures enable trigger append_only`;
      const r = await as(tx, w, w.me, async () => one(tx<{ ok: boolean; signatures_ok: boolean }[]>`select * from app.verify_submission(${id})`));
      expect(r).toMatchObject({ ok: false, signatures_ok: false });
    });
  });

  it('editing the definition later leaves old submissions, their questions and their verification untouched', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const v1 = await defineAndPublish(tx, w);
      let id = '';
      await as(tx, w, w.me, async () => { id = await submit(tx, v1, OK); });
      await defineAndPublish(tx, w, { fields: [{ key: 'only', label: 'Only question', type: 'text', required: true }] });
      const [s] = await tx<{ snap: { version: number; fields: { key: string }[] } }[]>`select definition_snapshot as snap from form_submissions where id = ${id}`;
      expect(s!.snap.version).toBe(1);
      expect(s!.snap.fields.map((f) => f.key)).toEqual(['what', 'injured', 'injury', 'severity', 'hours']);
      expect(await as(tx, w, w.me, async () => one(tx<{ ok: boolean }[]>`select ok from app.verify_submission(${id})`))).toEqual({ ok: true });
      await as(tx, w, w.me, async () => {
        await expectDbError(tx, /not open for submissions/, () => submit(tx, v1, OK));
      });
    });
  });

  it('submissions, signatures and decisions are append-only, even for the table owner', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const def = await defineAndPublish(tx, w);
      let id = '';
      await as(tx, w, w.me, async () => { id = await submit(tx, def, OK); });
      await expectDbError(tx, /append-only/, () => tx`update form_submissions set answers = '{}' where id = ${id}`);
      await expectDbError(tx, /append-only/, () => tx`delete from form_submissions where id = ${id}`);
      await expectDbError(tx, /append-only/, () => tx`update form_signatures set method = 'drawn'`);
      await expectDbError(tx, /append-only/, () => tx`delete from form_signatures`);
      await as(tx, w, w.me, async () => {
        await expectDbError(tx, /permission denied/, () => tx`delete from form_submissions`);
        await expectDbError(tx, /permission denied/, () => tx`insert into form_decisions (tenant_id, submission_id, decision) values (${w.t}, ${id}, 'approved')`);
      });
    });
  });
});

describe('approval', () => {
  it('only an officer at the submitter’s station decides; not the submitter; once', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const def = await defineAndPublish(tx, w);
      let id = '';
      await as(tx, w, w.me, async () => { id = await submit(tx, def, OK); });
      const selfApprover = await person(tx, w.t, ['forms.submit', 'forms.approve'], undefined, ['Self', 'Approver']);
      await tx`insert into member_assignments (tenant_id, member_id, org_unit_id, effective) values (${w.t}, ${selfApprover.m}, ${w.s1}, '[2020-01-01,)')`;
      let own = '';
      await as(tx, w, selfApprover, async () => { own = await submit(tx, def, OK, { method: 'typed', typed_name: 'Self Approver' }); });
      await as(tx, w, w.me, async () => {
        await expectDbError(tx, /cannot decide your own/, () => tx`select app.decide_form(${id}, 'approved', null)`);
      });
      await as(tx, w, selfApprover, async () => {
        await expectDbError(tx, /cannot decide your own/, () => tx`select app.decide_form(${own}, 'approved', null)`);
      });
      await as(tx, w, w.officer2, async () => {
        expect((await tx`select 1 from form_submissions`).length).toBe(0);
        await expectDbError(tx, /not in your scope/, () => tx`select app.decide_form(${id}, 'approved', null)`);
      });
      await as(tx, w, w.officer1, async () => {
        expect((await tx`select 1 from form_submissions where id = ${id}`).length).toBe(1);
        await expectDbError(tx, /at least 5 characters/, () => tx`select app.decide_form(${id}, 'returned', 'no')`);
        await tx`select app.decide_form(${id}, 'approved', null)`;
        await expectDbError(tx, /already has a decision/, () => tx`select app.decide_form(${id}, 'rejected', 'Changed my mind later')`);
      });
      expect((await one(tx<{ status: string }[]>`select status from form_status where submission_id = ${id}`)).status).toBe('approved');
      expect((await tx`select 1 from notifications where member_id = ${w.me.m} and kind = 'form-decision'`).length).toBe(1);
    });
  });

  it('notifies officers at the station (and department-wide approvers), not officers elsewhere', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const def = await defineAndPublish(tx, w);
      await as(tx, w, w.me, async () => { await submit(tx, def, OK); });
      const notified = (await tx<{ member_id: string }[]>`select member_id from notifications where kind = 'form-approval' and tenant_id = ${w.t}`).map((n) => n.member_id);
      expect(notified.sort()).toEqual([w.chief.m, w.officer1.m].sort());
    });
  });

  it('a returned submission is corrected by a new one that links back; only once; the original stays', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const def = await defineAndPublish(tx, w);
      let first = '';
      await as(tx, w, w.me, async () => { first = await submit(tx, def, OK); });
      await as(tx, w, w.officer1, async () => { await tx`select app.decide_form(${first}, 'returned', 'Please add the unit number')`; });
      let second = '';
      await as(tx, w, w.me, async () => {
        second = await submit(tx, def, { ...OK, what: 'Slipped on the ramp at Unit 4' }, undefined, first);
        await expectDbError(tx, /already corrected/, () => submit(tx, def, OK, undefined, first));
      });
      await as(tx, w, w.other, async () => {
        await expectDbError(tx, /only correct your own/, () => submit(tx, def, OK, { method: 'typed', typed_name: 'Olive Other' }, first));
      });
      const rows = await tx<{ id: string; corrects_id: string | null }[]>`select id, corrects_id from form_submissions order by submitted_at`;
      expect(rows).toEqual([{ id: first, corrects_id: null }, { id: second, corrects_id: first }]);
      expect((await one(tx<{ status: string }[]>`select status from form_status where submission_id = ${first}`)).status).toBe('returned');
    });
  });

  it('void: the submitter before a decision, or a forms manager; never twice', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const def = await defineAndPublish(tx, w);
      let a = '';
      let b = '';
      await as(tx, w, w.me, async () => { a = await submit(tx, def, OK); b = await submit(tx, def, { ...OK, what: 'Second one' }); });
      await as(tx, w, w.other, async () => {
        await expectDbError(tx, /only the submitter, before any decision/, () => tx`select app.void_form(${a}, 'Not mine to void')`);
      });
      await as(tx, w, w.me, async () => {
        await expectDbError(tx, /at least 5 characters/, () => tx`select app.void_form(${a}, 'no')`);
        await tx`select app.void_form(${a}, 'Entered by mistake')`;
        await expectDbError(tx, /already void/, () => tx`select app.void_form(${a}, 'Entered by mistake')`);
      });
      await as(tx, w, w.officer1, async () => { await tx`select app.decide_form(${b}, 'approved', null)`; });
      await as(tx, w, w.me, async () => {
        await expectDbError(tx, /only the submitter, before any decision/, () => tx`select app.void_form(${b}, 'Too late for me')`);
      });
      await as(tx, w, w.chief, async () => { await tx`select app.void_form(${b}, 'Duplicate of another report')`; });
      expect((await one(tx<{ status: string }[]>`select status from form_status where submission_id = ${b}`)).status).toBe('void');
    });
  });

  it('a form without officer approval cannot be decided', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const def = await defineAndPublish(tx, w, { key: 'receipt', approval: 'none', signature: false });
      let id = '';
      await as(tx, w, w.me, async () => { id = await submit(tx, def, OK, null); });
      await as(tx, w, w.officer1, async () => {
        await expectDbError(tx, /does not need approval/, () => tx`select app.decide_form(${id}, 'approved', null)`);
      });
    });
  });
});

describe('who can see submissions', () => {
  it('the submitter, officers at their station, forms.view_all; not other stations or members', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const def = await defineAndPublish(tx, w);
      await as(tx, w, w.me, async () => { await submit(tx, def, OK); });
      const count = (who: { u: string }) => as(tx, w, who, async () => [
        (await tx`select 1 from form_submissions`).length, (await tx`select 1 from form_signatures`).length,
      ]);
      expect(await count(w.me)).toEqual([1, 1]);
      expect(await count(w.officer1)).toEqual([1, 1]);
      expect(await count(w.chief)).toEqual([1, 1]);
      expect(await count(w.viewer)).toEqual([1, 1]);
      expect(await count(w.officer2)).toEqual([0, 0]);
      expect(await count(w.other)).toEqual([0, 0]);
      expect(await count(w.nobody)).toEqual([0, 0]);
    });
  });

  it('is tenant isolated for every table', async () => {
    await withAdmin(async (tx) => {
      const a = await world(tx);
      const b = await world(tx);
      const def = await defineAndPublish(tx, a);
      let id = '';
      await as(tx, a, a.me, async () => { id = await submit(tx, def, OK); });
      await as(tx, a, a.officer1, async () => { await tx`select app.decide_form(${id}, 'approved', null)`; });
      await as(tx, b, b.chief, async () => {
        for (const table of ['form_definitions', 'form_submissions', 'form_signatures', 'form_decisions']) {
          expect((await tx`select 1 from ${tx(table)}`).length, table).toBe(0);
        }
        await expectDbError(tx, /unknown submission/, () => tx`select app.void_form(${id}, 'Not in my department')`);
      });
    });
  });
});
