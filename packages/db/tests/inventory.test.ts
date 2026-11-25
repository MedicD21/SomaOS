import { afterAll, describe, expect, it } from 'vitest';
import { createSql } from '../src/client';
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

async function world(tx: Tx) {
  const t = await createTenant(tx);
  const s1 = await createOrgUnit(tx, t, 'Station 1');
  const s2 = await createOrgUnit(tx, t, 'Station 2');
  const loc = async (name: string, kind: string, parent: string | null, unit: string | null) =>
    (await tx<{ id: string }[]>`insert into stock_locations (tenant_id, name, kind, parent_id, org_unit_id) values (${t}, ${name}, ${kind}, ${parent}, ${unit}) returning id`)[0]!.id;
  const store = await loc('Main storeroom', 'storeroom', null, null);
  const st1 = await loc('Station 1 supply', 'station', null, s1);
  const bag1 = await loc('Engine 1 jump bag', 'compartment', st1, null);   // inherits Station 1
  const st2 = await loc('Station 2 supply', 'station', null, s2);
  const [gauze] = await tx<{ id: string }[]>`insert into items (tenant_id, sku, name, unit) values (${t}, 'GZ-1', 'Gauze 4x4', 'pack') returning id`;
  const [tape] = await tx<{ id: string }[]>`insert into items (tenant_id, sku, name) values (${t}, 'TP-1', 'Tape') returning id`;
  const manager = await person(tx, t, ['inventory.stock.manage', 'inventory.stock.view']);
  const user1 = await person(tx, t, ['inventory.stock.use', 'inventory.stock.view'], { scopeKind: 'org_unit', orgUnitId: s1 });
  const user2 = await person(tx, t, ['inventory.stock.use', 'inventory.stock.view'], { scopeKind: 'org_unit', orgUnitId: s2 });
  const mgr1 = await person(tx, t, ['inventory.stock.manage', 'inventory.stock.view'], { scopeKind: 'org_unit', orgUnitId: s1 });
  const viewer = await person(tx, t, ['inventory.stock.view']);
  const nobody = await person(tx, t, []);
  return { t, s1, s2, store, st1, bag1, st2, gauze: gauze!.id, tape: tape!.id, manager, user1, user2, mgr1, viewer, nobody };
}
type W = Awaited<ReturnType<typeof world>>;
const as = <T>(tx: Tx, w: { t: string }, who: { u: string }, fn: () => Promise<T>) => asUser(tx, { sub: who.u, tenant_id: w.t }, fn);
const receive = (tx: Tx, loc: string, item: string, qty: number) => tx`select app.receive_stock(${loc}, ${item}, ${qty}, '{}'::jsonb)`;
const use = (tx: Tx, loc: string, item: string, qty: number, reason: string | null = null) => tx`select app.use_stock(${loc}, ${item}, ${qty}, ${reason})`;
const onHand = async (tx: Tx, loc: string, item: string) =>
  Number((await tx<{ s: string | null }[]>`select sum(delta) as s from stock_ledger where location_id = ${loc} and item_id = ${item}`)[0]!.s ?? 0);

describe('receiving and using', () => {
  it('receive needs stock.manage at the location (inherited down the tree); use needs use or manage', async () => {
    await withAdmin(async (tx) => {
      const w: W = await world(tx);
      for (const who of [w.user1, w.viewer, w.nobody]) {
        await as(tx, w, who, async () => {
          await expectDbError(tx, /cannot receive stock/, () => receive(tx, w.st1, w.gauze, 5));
        });
      }
      await as(tx, w, w.mgr1, async () => {
        await receive(tx, w.st1, w.gauze, 10);
        await receive(tx, w.bag1, w.gauze, 4);                                  // child inherits Station 1
        await expectDbError(tx, /cannot receive stock/, () => receive(tx, w.st2, w.gauze, 1));
        await expectDbError(tx, /cannot receive stock/, () => receive(tx, w.store, w.gauze, 1)); // no unit = department-wide
        await expectDbError(tx, /above zero/, () => receive(tx, w.st1, w.gauze, 0));
      });
      await as(tx, w, w.user1, async () => {
        await use(tx, w.st1, w.gauze, 3, 'Patient care');
        await use(tx, w.bag1, w.gauze, 1);
        await expectDbError(tx, /cannot use stock/, () => use(tx, w.st2, w.gauze, 1));
      });
      expect(await onHand(tx, w.st1, w.gauze)).toBe(7);
      expect(await onHand(tx, w.bag1, w.gauze)).toBe(3);
      const [u] = await tx<{ performed_by: string; delta: string; type: string }[]>`select performed_by, delta, type from stock_ledger where tenant_id = ${w.t} and type = 'use' and reason = 'Patient care'`;
      expect(u).toMatchObject({ performed_by: w.user1.m, type: 'use' });
      expect(Number(u!.delta)).toBe(-3);
    });
  });

  it('never goes below zero, and refuses unknown, archived items and locations', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.manager, async () => {
        await receive(tx, w.st1, w.gauze, 5);
        await expectDbError(tx, /Not enough stock: only 5/, () => use(tx, w.st1, w.gauze, 6));
        await expectDbError(tx, /Not enough stock/, () => tx`select app.adjust_stock(${w.st1}, ${w.gauze}, -6, 'Count correction')`);
        await expectDbError(tx, /Unknown item/, () => use(tx, w.st1, crypto.randomUUID(), 1));
      });
      await tx`update items set archived_at = now() where id = ${w.gauze}`;
      await tx`update stock_locations set archived_at = now() where id = ${w.st2}`;
      await as(tx, w, w.manager, async () => {
        await expectDbError(tx, /That item is archived/, () => receive(tx, w.st1, w.gauze, 1));
        await expectDbError(tx, /That location is archived/, () => receive(tx, w.st2, w.tape, 1));
      });
      expect(await onHand(tx, w.st1, w.gauze)).toBe(5); // history kept
    });
  });

  it('adjust needs manage and a reason; in either direction', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.user1, async () => {
        await expectDbError(tx, /cannot adjust stock/, () => tx`select app.adjust_stock(${w.st1}, ${w.gauze}, 5, 'Found extras')`);
      });
      await as(tx, w, w.mgr1, async () => {
        await expectDbError(tx, /at least 5 characters/, () => tx`select app.adjust_stock(${w.st1}, ${w.gauze}, 5, 'no')`);
        await expectDbError(tx, /other than zero/, () => tx`select app.adjust_stock(${w.st1}, ${w.gauze}, 0, 'Nothing changed')`);
        await tx`select app.adjust_stock(${w.st1}, ${w.gauze}, 12, 'Opening count')`;
        await tx`select app.adjust_stock(${w.st1}, ${w.gauze}, -2, 'Damaged packs')`;
      });
      expect(await onHand(tx, w.st1, w.gauze)).toBe(10);
    });
  });
});

describe('transfers', () => {
  it('moves stock with two rows sharing a transfer id; needs access at both ends; never overdraws', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.manager, async () => { await receive(tx, w.st1, w.gauze, 10); });
      await as(tx, w, w.user1, async () => {
        await tx`select app.transfer_stock(${w.st1}, ${w.bag1}, ${w.gauze}, 4, 'Restock jump bag')`;
        await expectDbError(tx, /cannot transfer between/, () => tx`select app.transfer_stock(${w.st1}, ${w.st2}, ${w.gauze}, 1, null)`);
        await expectDbError(tx, /cannot transfer between/, () => tx`select app.transfer_stock(${w.st2}, ${w.st1}, ${w.gauze}, 1, null)`);
        await expectDbError(tx, /Not enough stock: only 6/, () => tx`select app.transfer_stock(${w.st1}, ${w.bag1}, ${w.gauze}, 7, null)`);
        await expectDbError(tx, /two different locations/, () => tx`select app.transfer_stock(${w.st1}, ${w.st1}, ${w.gauze}, 1, null)`);
        await expectDbError(tx, /above zero/, () => tx`select app.transfer_stock(${w.st1}, ${w.bag1}, ${w.gauze}, 0, null)`);
      });
      expect(await onHand(tx, w.st1, w.gauze)).toBe(6);
      expect(await onHand(tx, w.bag1, w.gauze)).toBe(4);
      const rows = await tx<{ type: string; transfer_id: string; delta: string }[]>`select type, transfer_id, delta from stock_ledger where tenant_id = ${w.t} and type like 'transfer%' order by type`;
      expect(rows).toHaveLength(2);
      expect(rows[0]!.transfer_id).toBe(rows[1]!.transfer_id);
      expect(Number(rows[0]!.delta) + Number(rows[1]!.delta)).toBe(0);
    });
  });

  it('two concurrent transfers of the last units: exactly one succeeds and totals stay consistent', async () => {
    const a = createSql();
    const b = createSql();
    const admin = createSql();
    try {
      // Committed setup in a throwaway tenant (the ledger is append-only, so it is left behind).
      const ids = await admin.begin(async (tx) => {
        const t = await createTenant(tx, `Race ${crypto.randomUUID().slice(0, 6)}`);
        const loc = async (name: string) =>
          (await tx<{ id: string }[]>`insert into stock_locations (tenant_id, name, kind) values (${t}, ${name}, 'storeroom') returning id`)[0]!.id;
        const from = await loc('From');
        const to1 = await loc('To 1');
        const to2 = await loc('To 2');
        const [item] = await tx<{ id: string }[]>`insert into items (tenant_id, name) values (${t}, 'Race item') returning id`;
        const p = await person(tx, t, ['inventory.stock.manage', 'inventory.stock.view']);
        await tx`insert into stock_ledger (tenant_id, location_id, item_id, delta, type, performed_by) values (${t}, ${from}, ${item!.id}, 10, 'receive', ${p.m})`;
        return { t, from, to1, to2, item: item!.id, u: p.u };
      });
      const attempt = (conn: ReturnType<typeof createSql>, to: string) =>
        conn.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ role: 'authenticated', sub: ids.u, tenant_id: ids.t })}, true)`;
          await tx`set local role authenticated`;
          await tx`select app.transfer_stock(${ids.from}, ${to}, ${ids.item}, 8, 'race')`;
        });
      const results = await Promise.allSettled([attempt(a, ids.to1), attempt(b, ids.to2)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(String(failed.reason)).toMatch(/Not enough stock/);
      const [sum] = await admin<{ s: string }[]>`select sum(delta) as s from stock_ledger where item_id = ${ids.item}`;
      expect(Number(sum!.s)).toBe(10);
      const [from] = await admin<{ s: string }[]>`select sum(delta) as s from stock_ledger where item_id = ${ids.item} and location_id = ${ids.from}`;
      expect(Number(from!.s)).toBe(2);
    } finally {
      await Promise.all([a.end(), b.end(), admin.end()]);
    }
  });
});

describe('par levels and low stock', () => {
  it('lists exactly the pairs below par, flags critical ones, and clears after a receive', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.user1, async () => {
        await expectDbError(tx, /cannot set par levels/, () => tx`select app.set_par(${w.st1}, ${w.gauze}, 10, 2)`);
      });
      await as(tx, w, w.mgr1, async () => {
        await expectDbError(tx, /minimum cannot exceed/, () => tx`select app.set_par(${w.st1}, ${w.gauze}, 5, 6)`);
        await tx`select app.set_par(${w.st1}, ${w.gauze}, 10, 2)`;     // on hand 0: critical
        await tx`select app.set_par(${w.st1}, ${w.tape}, 4, 0)`;
        await receive(tx, w.st1, w.tape, 4);                               // at par: not low
        await tx`select app.set_par(${w.bag1}, ${w.gauze}, 6, 1)`;
        await receive(tx, w.bag1, w.gauze, 3);                             // below par, above min
      });
      const low = async (who: { u: string }) => as(tx, w, who, async () =>
        (await tx<{ location_id: string; item_id: string; on_hand: string; short_by: string; critical: boolean }[]>`
          select location_id, item_id, on_hand, short_by, critical from low_stock order by short_by desc`));
      const rows = await low(w.viewer);
      expect(rows.map((r) => [r.location_id, r.item_id, Number(r.on_hand), Number(r.short_by), r.critical])).toEqual([
        [w.st1, w.gauze, 0, 10, true],
        [w.bag1, w.gauze, 3, 3, false],
      ]);
      expect((await low(w.nobody)).length).toBe(0);
      await as(tx, w, w.mgr1, async () => { await receive(tx, w.st1, w.gauze, 10); });
      expect((await low(w.viewer)).map((r) => r.location_id)).toEqual([w.bag1]);
    });
  });

  it('changes to par levels are audited', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.mgr1, async () => {
        await tx`select app.set_par(${w.st1}, ${w.gauze}, 10, 2)`;
        await tx`select app.set_par(${w.st1}, ${w.gauze}, 12, 3)`;
      });
      const rows = await tx<{ action: string }[]>`select action from audit_log where table_name = 'par_levels' and tenant_id = ${w.t} order by id`;
      expect(rows.map((r) => r.action)).toEqual(['insert', 'update']);
    });
  });
});

describe('locations, items and the ledger itself', () => {
  it('creates locations under a parent (inheriting the station), refuses bad input, never cycles', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.mgr1, async () => {
        const id = (await tx<{ id: string }[]>`select app.create_stock_location('Medic bag', 'container', ${w.bag1}, null) as id`)[0]!.id;
        await receive(tx, id, w.gauze, 2);                                 // inherits Station 1 through two levels
        await expectDbError(tx, /cannot add locations here/, () => tx`select app.create_stock_location('Elsewhere', 'container', ${w.st2}, null)`);
        await expectDbError(tx, /Choose a location type/, () => tx`select app.create_stock_location('X', 'shed', null, ${w.s1})`);
        await expectDbError(tx, /Unknown parent/, () => tx`select app.create_stock_location('X', 'container', ${crypto.randomUUID()}, null)`);
        await tx`select app.archive_stock_location(${id})`;
        await expectDbError(tx, /archived/, () => receive(tx, id, w.gauze, 1));
      });
    });
  });

  it('a controlled item cannot exist yet (Phase 3b)', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await expectDbError(tx, /is_controlled/, () => tx`insert into items (tenant_id, name, is_controlled) values (${w.t}, 'Fentanyl', true)`);
    });
  });

  it('the ledger is append-only and has no direct write path; items are managed by stock managers', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.manager, async () => { await receive(tx, w.st1, w.gauze, 5); });
      await expectDbError(tx, /append-only/, () => tx`update stock_ledger set delta = 99`);
      await expectDbError(tx, /append-only/, () => tx`delete from stock_ledger`);
      await expectDbError(tx, /append-only/, () => tx`truncate stock_ledger`);
      await as(tx, w, w.manager, async () => {
        await expectDbError(tx, /permission denied/, () => tx`insert into stock_ledger (tenant_id, location_id, item_id, delta, type, performed_by) values (${w.t}, ${w.st1}, ${w.gauze}, 5, 'receive', ${w.manager.m})`);
        await expectDbError(tx, /permission denied/, () => tx`update par_levels set par = 1`);
        await tx`insert into items (tenant_id, name) values (${w.t}, 'Bandage')`;
      });
      await as(tx, w, w.user1, async () => {
        await expectDbError(tx, /row-level security/, () => tx`insert into items (tenant_id, name) values (${w.t}, 'Nope')`);
      });
    });
  });

  it('stock_levels sums per location and item, and every table is tenant isolated', async () => {
    await withAdmin(async (tx) => {
      const a = await world(tx);
      const b = await world(tx);
      for (const w of [a, b]) {
        await as(tx, w, w.manager, async () => { await receive(tx, w.st1, w.gauze, 5); await use(tx, w.st1, w.gauze, 2); await tx`select app.set_par(${w.st1}, ${w.gauze}, 9, 1)`; });
      }
      await as(tx, a, a.viewer, async () => {
        const levels = await tx<{ on_hand: string }[]>`select on_hand from stock_levels`;
        expect(levels.map((l) => Number(l.on_hand))).toEqual([3]);
        for (const table of ['items', 'stock_locations', 'par_levels', 'stock_ledger']) {
          const rows = await tx<{ tenant_id: string }[]>`select distinct tenant_id from ${tx(table)}`;
          expect(rows.map((r) => r.tenant_id), table).toEqual([a.t]);
        }
      });
    });
  });
});
