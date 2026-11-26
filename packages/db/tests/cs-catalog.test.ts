import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { as, csWorld, person } from './cs-helpers';
import { createMember, createTenant } from './helpers';

afterAll(closeTestDb);

describe('catalog: items, lots, locations', () => {
  it('only department-wide custody.manage creates items and lots; everyone with a custody permission reads them', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      for (const who of [w.recorder, w.witness, w.auditor, w.manager1, w.nobody]) {
        await as(tx, w, who, async () => {
          await expectDbError(tx, /custody\.manage required/, () => tx`select app.create_cs_item('Fentanyl', 'II', null, 'mcg', null)`);
        });
      }
      let item = '';
      await as(tx, w, w.manager, async () => {
        item = (await tx<{ id: string }[]>`select app.create_cs_item('Fentanyl 50 mcg/mL', 'II', '00409-9094-01', 'mL', '2 mL ampule') as id`)[0]!.id;
        await tx`select app.create_cs_lot(${item}, 'F900', '2099-03-01')`;
        await expectDbError(tx, /already exists/, () => tx`select app.create_cs_item('Fentanyl 50 mcg/mL', 'II', '00409-9094-01', 'mL', null)`);
        await expectDbError(tx, /already exists/, () => tx`select app.create_cs_lot(${item}, 'F900', '2099-03-01')`);
        await expectDbError(tx, /Unknown unit/, () => tx`select app.create_cs_item('X', 'II', null, 'gram', null)`);
      });
      for (const who of [w.recorder, w.witness, w.auditor, w.manager1]) {
        await as(tx, w, who, async () => {
          expect((await tx`select 1 from cs_items`).length).toBe(2);
          expect((await tx`select 1 from cs_lots`).length).toBe(3);
        });
      }
      await as(tx, w, w.nobody, async () => {
        expect((await tx`select 1 from cs_items`).length).toBe(0);
      });
    });
  });

  it('locations: manage at the unit creates; reads are scoped to the unit (audit and manage department-wide)', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await as(tx, w, w.manager1, async () => {
        await tx`select app.create_cs_location('Station 1 safe', 'station', ${w.s1}, null, null)`;
        await expectDbError(tx, /cannot add locations/, () => tx`select app.create_cs_location('Station 2 safe', 'station', ${w.s2}, null, null)`);
      });
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /cannot add locations/, () => tx`select app.create_cs_location('Nope', 'station', ${w.s1}, null, null)`);
        expect((await tx<{ name: string }[]>`select name from cs_locations order by name`).map((r) => r.name)).toEqual(['Medic 1 box', 'Station 1 safe', 'Vault']);
      });
      await as(tx, w, w.recorderElsewhere, async () => {
        expect((await tx<{ name: string }[]>`select name from cs_locations`).map((r) => r.name)).toEqual(['Medic 2 box']);
      });
      await as(tx, w, w.auditor, async () => { expect((await tx`select 1 from cs_locations`).length).toBe(4); });
      await as(tx, w, w.nobody, async () => { expect((await tx`select 1 from cs_locations`).length).toBe(0); });
    });
  });

  it('a member location needs a member of this department; other kinds must not name one', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      const other = await createTenant(tx, 'Other FD');
      const stranger = await createMember(tx, other);
      const own = await person(tx, w.t, []);
      await as(tx, w, w.manager, async () => {
        await expectDbError(tx, /unknown member/i, () => tx`select app.create_cs_location('Medic bag', 'member', ${w.s1}, ${stranger}, null)`);
        await expectDbError(tx, /needs a member/i, () => tx`select app.create_cs_location('Medic bag', 'member', ${w.s1}, null, null)`);
        await expectDbError(tx, /only a member location/i, () => tx`select app.create_cs_location('Safe', 'vault', ${w.s1}, ${own.m}, null)`);
        await tx`select app.create_cs_location('Pat''s bag', 'member', ${w.s1}, ${own.m}, null)`;
      });
    });
  });

  it('archiving needs manage, refuses a location or lot that still holds stock, and never deletes', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await tx`insert into cs_ledger (tenant_id, location_id, lot_id, delta, type, performed_by, reason) values (${w.t}, ${w.box1}, ${w.lotA}, 5, 'receive', ${w.manager.m}, 'seed')`;
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /cannot archive/, () => tx`select app.archive_cs_location(${w.box1})`);
      });
      await as(tx, w, w.manager, async () => {
        await expectDbError(tx, /still holds stock/, () => tx`select app.archive_cs_location(${w.box1})`);
        await expectDbError(tx, /still holds stock/, () => tx`select app.archive_cs_lot(${w.lotA})`);
        await tx`select app.archive_cs_location(${w.box2})`;
        await tx`select app.archive_cs_lot(${w.lotB})`;
      });
      expect((await tx`select 1 from cs_locations where archived_at is not null`).length).toBe(1);
    });
  });

  it('recalling a lot needs manage, a real note, and is one-way', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /custody\.manage required/, () => tx`select app.flag_cs_lot_recall(${w.lotA}, 'Manufacturer recall')`);
      });
      await as(tx, w, w.manager, async () => {
        await expectDbError(tx, /at least 5 characters/, () => tx`select app.flag_cs_lot_recall(${w.lotA}, 'no')`);
        await tx`select app.flag_cs_lot_recall(${w.lotA}, 'Manufacturer recall 2026-11')`;
        await expectDbError(tx, /already recalled/, () => tx`select app.flag_cs_lot_recall(${w.lotA}, 'Manufacturer recall again')`);
      });
    });
  });

  it('has no direct writes and is tenant isolated', async () => {
    await withAdmin(async (tx) => {
      const a = await csWorld(tx);
      const b = await csWorld(tx);
      await as(tx, a, a.manager, async () => {
        expect((await tx<{ tenant_id: string }[]>`select distinct tenant_id from cs_items`).map((r) => r.tenant_id)).toEqual([a.t]);
        expect((await tx<{ tenant_id: string }[]>`select distinct tenant_id from cs_locations`).map((r) => r.tenant_id)).toEqual([a.t]);
        await expectDbError(tx, /permission denied/, () => tx`insert into cs_items (tenant_id, name, schedule, unit) values (${a.t}, 'X', 'II', 'mL')`);
        await expectDbError(tx, /permission denied/, () => tx`update cs_locations set chain_head = 'x'`);
        await expectDbError(tx, /unknown/i, () => tx`select app.archive_cs_location(${b.vault})`);
      });
    });
  });
});

describe('seals', () => {
  it('apply: drug boxes only, no current seal, never reuse a number; record or manage at the unit', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await as(tx, w, w.recorderElsewhere, async () => {
        await expectDbError(tx, /cannot seal/, () => tx`select app.apply_cs_seal(${w.box1}, 'S-1001')`);
      });
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /drug box/i, () => tx`select app.apply_cs_seal(${w.vault}, 'S-1000')`);
        await tx`select app.apply_cs_seal(${w.box1}, 'S-1001')`;
        await expectDbError(tx, /already has a seal/, () => tx`select app.apply_cs_seal(${w.box1}, 'S-1002')`);
      });
      await as(tx, w, w.recorderElsewhere, async () => {
        await expectDbError(tx, /already been used/, () => tx`select app.apply_cs_seal(${w.box2}, 'S-1001')`);
      });
      expect((await tx<{ current_seal_no: string }[]>`select current_seal_no from cs_locations where id = ${w.box1}`)[0]!.current_seal_no).toBe('S-1001');
    });
  });

  it('verify stores the result and returns whether the number matches', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await as(tx, w, w.recorder, async () => {
        await tx`select app.apply_cs_seal(${w.box1}, 'S-2001')`;
        expect((await tx<{ ok: boolean }[]>`select app.verify_cs_seal(${w.box1}, 'S-2001') as ok`)[0]!.ok).toBe(true);
        expect((await tx<{ ok: boolean }[]>`select app.verify_cs_seal(${w.box1}, 'S-9999') as ok`)[0]!.ok).toBe(false);
      });
      const rows = await tx<{ kind: string; ok: boolean | null }[]>`select kind, ok from cs_seal_events where location_id = ${w.box1} order by occurred_at, id`;
      expect(rows.map((r) => [r.kind, r.ok])).toEqual([['apply', null], ['verify', true], ['verify', false]]);
    });
  });

  it('seal events are append-only (even for the owner) and current_seal_no cannot be changed directly', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await as(tx, w, w.recorder, async () => { await tx`select app.apply_cs_seal(${w.box1}, 'S-3001')`; });
      await expectDbError(tx, /append-only/, () => tx`update cs_seal_events set seal_no = 'X'`);
      await expectDbError(tx, /append-only/, () => tx`delete from cs_seal_events`);
      await as(tx, w, w.manager, async () => {
        await expectDbError(tx, /permission denied/, () => tx`update cs_locations set current_seal_no = 'S-0' where id = ${w.box1}`);
        await expectDbError(tx, /permission denied/, () => tx`insert into cs_seal_events (tenant_id, location_id, kind, seal_no, performed_by) values (${w.t}, ${w.box1}, 'apply', 'Z', ${w.manager.m})`);
      });
    });
  });
});
