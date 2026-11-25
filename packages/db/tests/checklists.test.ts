import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { createMember, createOrgUnit, createRole, createTenant, grantRole, userInTenant } from './helpers';

afterAll(closeTestDb);

async function person(tx: Tx, t: string, perms: string[], scope?: Parameters<typeof grantRole>[4]) {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u });
  if (perms.length) await grantRole(tx, t, m, await createRole(tx, t, `r_${m.slice(0, 6)}`, perms), scope);
  return { u, m };
}

const ITEMS = [
  { key: 'tires', label: 'Tires and lights', kind: 'pass_fail', required: true },
  { key: 'fuel', label: 'Fuel level (%)', kind: 'number', required: true },
  { key: 'notes', label: 'Anything else', kind: 'text', required: false },
];

async function world(tx: Tx) {
  const t = await createTenant(tx);
  const s1 = await createOrgUnit(tx, t, 'Station 1');
  const s2 = await createOrgUnit(tx, t, 'Station 2');
  const [type] = await tx<{ id: string }[]>`insert into asset_types (tenant_id, key, label) values (${t}, 'engine', 'Engine') returning id`;
  const [other] = await tx<{ id: string }[]>`insert into asset_types (tenant_id, key, label) values (${t}, 'cot', 'Cot') returning id`;
  const [asset] = await tx<{ id: string }[]>`insert into assets (tenant_id, type_id, name, org_unit_id) values (${t}, ${type!.id}, 'Engine 1', ${s1}) returning id`;
  const manager = await person(tx, t, ['inventory.check.manage']);
  const member1 = await person(tx, t, ['inventory.check.perform'], { scopeKind: 'org_unit', orgUnitId: s1 });
  const member2 = await person(tx, t, ['inventory.check.perform'], { scopeKind: 'org_unit', orgUnitId: s2 });
  const viewer = await person(tx, t, ['inventory.asset.view']);
  const nobody = await person(tx, t, []);
  return { t, s1, s2, type: type!.id, otherType: other!.id, asset: asset!.id, manager, member1, member2, viewer, nobody };
}
type W = Awaited<ReturnType<typeof world>>;
const as = <T>(tx: Tx, w: W, who: { u: string }, fn: () => Promise<T>) => asUser(tx, { sub: who.u, tenant_id: w.t }, fn);
const save = async (tx: Tx, key = 'daily', items: unknown = ITEMS, assetType: string | null = null, logFailure = true) =>
  (await tx<{ id: string }[]>`select app.save_checklist_template(${key}, 'Daily check', ${assetType}, ${tx.json(items as never)}, ${logFailure}) as id`)[0]!.id;
const complete = async (tx: Tx, tpl: string, asset: string | null, answers: object, unit: string | null = null) =>
  (await tx<{ id: string }[]>`select app.complete_checklist(${tpl}, ${asset}, ${tx.json(answers as never)}, null, ${unit}) as id`)[0]!.id;
const OK = { tires: 'pass', fuel: 80 };

describe('saving templates', () => {
  it('needs inventory.check.manage; validates items; each save is a new active version', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.member1, async () => {
        await expectDbError(tx, /inventory\.check\.manage required/, () => save(tx));
      });
      await as(tx, w, w.manager, async () => {
        await expectDbError(tx, /items are invalid/, () => save(tx, 'daily', []));
        await expectDbError(tx, /items are invalid/, () => save(tx, 'daily', [{ key: 'a', label: 'A', kind: 'pass_fail' }, { key: 'a', label: 'B', kind: 'text' }]));
        await expectDbError(tx, /items are invalid/, () => save(tx, 'daily', [{ key: 'a', label: 'A', kind: 'checkbox' }]));
        await expectDbError(tx, /items are invalid/, () => save(tx, 'daily', Array.from({ length: 201 }, (_, i) => ({ key: `k${i}`, label: 'x', kind: 'text' }))));
        await expectDbError(tx, /Invalid checklist key/, () => save(tx, 'Bad Key'));
        await expectDbError(tx, /Unknown asset type/, () => tx`select app.save_checklist_template('daily', 'D', ${crypto.randomUUID()}, ${tx.json(ITEMS as never)}, true)`);
        const v1 = await save(tx);
        const v2 = await save(tx);
        const rows = await tx<{ id: string; version: number; active: boolean }[]>`select id, version, active from checklist_templates where key = 'daily' order by version`;
        expect(rows).toEqual([{ id: v1, version: 1, active: false }, { id: v2, version: 2, active: true }]);
      });
    });
  });

  it('cannot be written directly', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.manager, async () => {
        await expectDbError(tx, /permission denied/, () => tx`insert into checklist_templates (tenant_id, key, label, version, items) values (${w.t}, 'x', 'X', 1, ${tx.json(ITEMS as never)})`);
      });
    });
  });
});

describe('completing checklists', () => {
  it('needs the permission at the asset’s unit; required items must be answered; answers are typed', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let tpl = '';
      await as(tx, w, w.manager, async () => { tpl = await save(tx); });
      for (const who of [w.member2, w.viewer, w.nobody]) {
        await as(tx, w, who, async () => {
          await expectDbError(tx, /cannot complete checks/, () => complete(tx, tpl, w.asset, OK));
        });
      }
      await as(tx, w, w.member1, async () => {
        await expectDbError(tx, /Answer every required item: Tires and lights/, () => complete(tx, tpl, w.asset, { fuel: 80 }));
        await expectDbError(tx, /Answer every required item: Fuel/, () => complete(tx, tpl, w.asset, { tires: 'pass' }));
        await expectDbError(tx, /Answer pass or fail/, () => complete(tx, tpl, w.asset, { tires: 'ok', fuel: 80 }));
        await expectDbError(tx, /Enter a number/, () => complete(tx, tpl, w.asset, { tires: 'pass', fuel: 'full' }));
        await expectDbError(tx, /Unknown checklist item: bogus/, () => complete(tx, tpl, w.asset, { ...OK, bogus: 1 }));
        await complete(tx, tpl, w.asset, { ...OK, notes: 'All good' });
      });
    });
  });

  it('records the caller as the member, copies the template, counts failures and logs one asset event', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let tpl = '';
      await as(tx, w, w.manager, async () => { tpl = await save(tx); });
      let id = '';
      await as(tx, w, w.member1, async () => { id = await complete(tx, tpl, w.asset, { tires: 'fail', fuel: 40 }); });
      const [c] = await tx<{ completed_by: string; failed_count: number; template_snapshot: { version: number; items: unknown[] }; org_unit_id: string }[]>`
        select completed_by, failed_count, template_snapshot, org_unit_id from checklist_completions where id = ${id}`;
      expect(c).toMatchObject({ completed_by: w.member1.m, failed_count: 1, org_unit_id: w.s1 });
      expect(c!.template_snapshot.version).toBe(1);
      expect(c!.template_snapshot.items).toHaveLength(3);
      const events = await tx<{ kind: string; data: { completion_id: string; failed_count: number } }[]>`select kind, data from asset_events where asset_id = ${w.asset} and kind = 'check'`;
      expect(events).toHaveLength(1);
      expect(events[0]!.data).toEqual({ completion_id: id, failed_count: 1 });
      // A failed item does not change the asset's status.
      expect((await tx<{ status: string }[]>`select status from assets where id = ${w.asset}`)[0]!.status).toBe('in_service');
    });
  });

  it('only logs clean completions when log_failure is off', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let tpl = '';
      await as(tx, w, w.manager, async () => { tpl = await save(tx, 'daily', ITEMS, null, false); });
      await as(tx, w, w.member1, async () => {
        await complete(tx, tpl, w.asset, { tires: 'fail', fuel: 40 });
        await complete(tx, tpl, w.asset, OK);
      });
      expect((await tx`select 1 from asset_events where asset_id = ${w.asset} and kind = 'check'`).length).toBe(1);
      expect((await tx`select 1 from checklist_completions`).length).toBe(2);
    });
  });

  it('editing a template leaves old completions unchanged and the old version cannot be completed', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let v1 = '';
      let v2 = '';
      let id = '';
      await as(tx, w, w.manager, async () => { v1 = await save(tx); });
      await as(tx, w, w.member1, async () => { id = await complete(tx, v1, w.asset, OK); });
      await as(tx, w, w.manager, async () => { v2 = await save(tx, 'daily', [{ key: 'only', label: 'Only item', kind: 'pass_fail', required: true }]); });
      const [c] = await tx<{ template_snapshot: { version: number; items: { key: string }[] } }[]>`select template_snapshot from checklist_completions where id = ${id}`;
      expect(c!.template_snapshot.version).toBe(1);
      expect(c!.template_snapshot.items.map((i) => i.key)).toEqual(['tires', 'fuel', 'notes']);
      await as(tx, w, w.member1, async () => {
        await expectDbError(tx, /newer version/, () => complete(tx, v1, w.asset, OK));
        await complete(tx, v2, w.asset, { only: 'pass' });
      });
    });
  });

  it('respects the template’s asset type and refuses retired assets', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let tpl = '';
      await as(tx, w, w.manager, async () => { tpl = await save(tx, 'cot_check', ITEMS, w.otherType); });
      await as(tx, w, w.member1, async () => {
        await expectDbError(tx, /different type of asset/, () => complete(tx, tpl, w.asset, OK));
      });
      let engine = '';
      await as(tx, w, w.manager, async () => { engine = await save(tx, 'engine_check', ITEMS, w.type); });
      await tx`update assets set status = 'retired' where id = ${w.asset}`;
      await as(tx, w, w.member1, async () => {
        await expectDbError(tx, /retired; it cannot be checked/, () => complete(tx, engine, w.asset, OK));
      });
    });
  });

  it('a station check with no asset needs the permission at that unit, or department-wide with none', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let tpl = '';
      await as(tx, w, w.manager, async () => { tpl = await save(tx); });
      await as(tx, w, w.member1, async () => {
        await complete(tx, tpl, null, OK, w.s1);
        await expectDbError(tx, /cannot complete checks/, () => complete(tx, tpl, null, OK, w.s2));
        await expectDbError(tx, /cannot complete checks/, () => complete(tx, tpl, null, OK, null));
      });
    });
  });

  it('completions are append-only, readable by their member and by viewers/managers, and tenant isolated', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let tpl = '';
      await as(tx, w, w.manager, async () => { tpl = await save(tx); });
      await as(tx, w, w.member1, async () => { await complete(tx, tpl, w.asset, OK); });
      await expectDbError(tx, /append-only/, () => tx`update checklist_completions set note = 'x'`);
      await expectDbError(tx, /append-only/, () => tx`delete from checklist_completions`);
      await expectDbError(tx, /append-only/, () => tx`truncate checklist_completions`);
      const count = (who: { u: string }) => as(tx, w, who, async () => (await tx`select 1 from checklist_completions`).length);
      expect(await count(w.member1)).toBe(1);
      expect(await count(w.viewer)).toBe(1);
      expect(await count(w.manager)).toBe(1);
      expect(await count(w.member2)).toBe(0);
      expect(await count(w.nobody)).toBe(0);
      const other = await world(tx);
      expect(await as(tx, other, other.manager, async () => (await tx`select 1 from checklist_templates`).length)).toBe(0);
      expect(await as(tx, other, other.viewer, async () => (await tx`select 1 from checklist_completions`).length)).toBe(0);
    });
  });
});
