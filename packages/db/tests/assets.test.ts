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

async function world(tx: Tx) {
  const t = await createTenant(tx);
  const s1 = await createOrgUnit(tx, t, 'Station 1');
  const s2 = await createOrgUnit(tx, t, 'Station 2');
  const [type] = await tx<{ id: string }[]>`insert into asset_types (tenant_id, key, label, category) values (${t}, 'engine', 'Engine', 'apparatus') returning id`;
  const manager = await person(tx, t, ['inventory.asset.manage', 'inventory.asset.view', 'inventory.asset.event']);
  const off1 = await person(tx, t, ['inventory.asset.view', 'inventory.asset.event'], { scopeKind: 'org_unit', orgUnitId: s1 });
  const off2 = await person(tx, t, ['inventory.asset.view', 'inventory.asset.event'], { scopeKind: 'org_unit', orgUnitId: s2 });
  const viewer = await person(tx, t, ['inventory.asset.view']);
  const nobody = await person(tx, t, []);
  return { t, s1, s2, type: type!.id, manager, off1, off2, viewer, nobody };
}

type W = Awaited<ReturnType<typeof world>>;
const as = <T>(tx: Tx, w: W, who: { u: string }, fn: () => Promise<T>) => asUser(tx, { sub: who.u, tenant_id: w.t }, fn);
const mk = async (tx: Tx, w: W, unit: string | null = w.s1, name = 'Engine 1', ident: string | null = null, custom: object = {}) =>
  (await tx<{ id: string }[]>`select app.create_asset(${w.type}, ${name}, ${ident}, ${unit}, ${tx.json(custom as never)}) as id`)[0]!.id;
const event = (tx: Tx, asset: string, kind: string, status: string | null, unit: string | null, note: string | null) =>
  tx<{ id: string }[]>`select app.record_asset_event(${asset}, ${kind}, ${status}, ${unit}, ${note}) as id`;
const eventsOf = async (tx: Tx, asset: string) => (await tx<{ kind: string }[]>`select kind from asset_events where asset_id = ${asset} order by occurred_at, id`).map((r) => r.kind);

describe('creating assets', () => {
  it('needs inventory.asset.manage at the location; anyone with view reads department-wide', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const scopedMgr = await person(tx, w.t, ['inventory.asset.manage'], { scopeKind: 'org_unit', orgUnitId: w.s1 });
      for (const who of [w.off1, w.viewer, w.nobody]) {
        await as(tx, w, who, async () => {
          await expectDbError(tx, /cannot add assets/, () => mk(tx, w));
        });
      }
      await as(tx, w, scopedMgr, async () => {
        await mk(tx, w, w.s1);
        await expectDbError(tx, /cannot add assets/, () => mk(tx, w, w.s2));
        await expectDbError(tx, /cannot add assets/, () => mk(tx, w, null));
      });
      await as(tx, w, w.manager, async () => { await mk(tx, w, null, 'Spare'); });
      // Department-wide reads: any viewer sees assets at every station; a non-viewer sees none.
      await as(tx, w, w.off2, async () => { expect((await tx`select 1 from assets`).length).toBe(2); });
      await as(tx, w, w.viewer, async () => { expect((await tx`select 1 from assets`).length).toBe(2); });
      await as(tx, w, w.nobody, async () => { expect((await tx`select 1 from assets`).length).toBe(0); });
    });
  });

  it('validates name, type, location and identifier uniqueness; writes an "added" event', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const other = await createTenant(tx, 'Other FD');
      const [otherType] = await tx<{ id: string }[]>`insert into asset_types (tenant_id, key, label) values (${other}, 'engine', 'Engine') returning id`;
      await as(tx, w, w.manager, async () => {
        await expectDbError(tx, /Enter a name/, () => mk(tx, w, w.s1, '  '));
        await expectDbError(tx, /Unknown or archived asset type/, () => tx`select app.create_asset(${otherType!.id}, 'X', null, ${w.s1}, '{}'::jsonb)`);
        const id = await mk(tx, w, w.s1, 'Engine 1', 'E-1');
        expect(await eventsOf(tx, id)).toEqual(['note']);
        await expectDbError(tx, /assets_identifier_key/, () => mk(tx, w, w.s1, 'Engine 2', 'E-1'));
      });
    });
  });

  it('enforces the asset custom-field registry: unknown, archived and missing-required fields are refused', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await tx`insert into custom_field_defs (tenant_id, entity, key, label, type, required) values (${w.t}, 'asset', 'serial', 'Serial number', 'text', true)`;
      await tx`insert into custom_field_defs (tenant_id, entity, key, label, type, archived_at) values (${w.t}, 'asset', 'old', 'Old field', 'text', now())`;
      await as(tx, w, w.manager, async () => {
        await expectDbError(tx, /Missing required asset field: Serial number/, () => mk(tx, w));
        await expectDbError(tx, /Unknown asset field: nope/, () => mk(tx, w, w.s1, 'E', null, { serial: 'A1', nope: 1 }));
        await expectDbError(tx, /Unknown asset field: old/, () => mk(tx, w, w.s1, 'E', null, { serial: 'A1', old: 'x' }));
        const id = await mk(tx, w, w.s1, 'E', null, { serial: 'A1' });
        expect((await tx<{ custom: { serial: string } }[]>`select custom from assets where id = ${id}`)[0]!.custom.serial).toBe('A1');
      });
    });
  });

  it('a type from another tenant is refused by the composite foreign key', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const other = await createTenant(tx, 'Other FD');
      const [otherType] = await tx<{ id: string }[]>`insert into asset_types (tenant_id, key, label) values (${other}, 'engine', 'Engine') returning id`;
      await expectDbError(tx, /violates foreign key/, () => tx`insert into assets (tenant_id, type_id, name) values (${w.t}, ${otherType!.id}, 'Bad')`);
    });
  });
});

describe('events, status and moves', () => {
  it('a status change updates the asset and writes exactly one event; reasons are required for out of service', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let id = '';
      await as(tx, w, w.manager, async () => { id = await mk(tx, w); });
      await as(tx, w, w.off1, async () => {
        await expectDbError(tx, /at least 5 characters/, () => event(tx, id, 'status_change', 'out_of_service', null, 'no'));
        await expectDbError(tx, /Choose a status/, () => event(tx, id, 'status_change', 'broken', null, 'reason here'));
        await expectDbError(tx, /already in service/, () => event(tx, id, 'status_change', 'in_service', null, null));
        await event(tx, id, 'status_change', 'out_of_service', null, 'Pump failed inspection');
        await event(tx, id, 'status_change', 'in_service', null, null);
        await event(tx, id, 'status_change', 'maintenance', null, null);
      });
      expect(await eventsOf(tx, id)).toEqual(['note', 'status_change', 'status_change', 'status_change']);
      const [row] = await tx<{ status: string }[]>`select status from assets where id = ${id}`;
      expect(row!.status).toBe('maintenance');
      const [e] = await tx<{ from_status: string; to_status: string; performed_by: string }[]>`
        select from_status, to_status, performed_by from asset_events where asset_id = ${id} and to_status = 'out_of_service'`;
      expect(e).toMatchObject({ from_status: 'in_service', to_status: 'out_of_service', performed_by: w.off1.u });
    });
  });

  it('only people with the event permission at the asset’s unit can log events; others can read', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let id = '';
      await as(tx, w, w.manager, async () => { id = await mk(tx, w); });
      for (const who of [w.off2, w.viewer, w.nobody]) {
        await as(tx, w, who, async () => {
          await expectDbError(tx, /cannot log events/, () => event(tx, id, 'note', null, null, 'Looks fine'));
        });
      }
      await as(tx, w, w.off2, async () => { expect((await tx`select 1 from asset_events where asset_id = ${id}`).length).toBe(1); });
    });
  });

  it('a move needs the permission at both the old and the new location', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let id = '';
      await as(tx, w, w.manager, async () => { id = await mk(tx, w, w.s1); });
      await as(tx, w, w.off1, async () => {
        await expectDbError(tx, /cannot move assets to that location/, () => event(tx, id, 'assignment', null, w.s2, 'Reassigned'));
        await expectDbError(tx, /Choose the new location/, () => event(tx, id, 'assignment', null, null, null));
        await expectDbError(tx, /already at that location/, () => event(tx, id, 'assignment', null, w.s1, null));
      });
      await as(tx, w, w.off2, async () => {
        await expectDbError(tx, /cannot log events/, () => event(tx, id, 'assignment', null, w.s2, 'Taking it'));
      });
      await as(tx, w, w.manager, async () => { await event(tx, id, 'assignment', null, w.s2, 'Moved to station 2'); });
      const [a] = await tx<{ org_unit_id: string }[]>`select org_unit_id from assets where id = ${id}`;
      expect(a!.org_unit_id).toBe(w.s2);
      const [e] = await tx<{ from_org_unit_id: string; to_org_unit_id: string }[]>`select from_org_unit_id, to_org_unit_id from asset_events where asset_id = ${id} and kind = 'assignment'`;
      expect(e).toEqual({ from_org_unit_id: w.s1, to_org_unit_id: w.s2 });
    });
  });

  it('a retired asset only accepts notes, and can then be archived (with a reason) and refuses everything', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let id = '';
      await as(tx, w, w.manager, async () => {
        id = await mk(tx, w);
        await expectDbError(tx, /Retire the asset before archiving/, () => tx`select app.archive_asset(${id}, 'Not needed any more')`);
        await event(tx, id, 'status_change', 'retired', null, 'Sold at surplus auction');
        await expectDbError(tx, /retired; only notes/, () => event(tx, id, 'status_change', 'in_service', null, null));
        await expectDbError(tx, /retired; only notes/, () => event(tx, id, 'maintenance', null, null, 'Service'));
        await event(tx, id, 'note', null, null, 'Paperwork filed');
        await expectDbError(tx, /at least 5 characters/, () => tx`select app.archive_asset(${id}, 'no')`);
        await tx`select app.archive_asset(${id}, 'Removed from the fleet list')`;
        await expectDbError(tx, /already archived|This asset is archived/, () => tx`select app.archive_asset(${id}, 'Removed again')`);
        await expectDbError(tx, /This asset is archived/, () => event(tx, id, 'note', null, null, 'Another note'));
      });
    });
  });
});

describe('append-only and direct writes', () => {
  it('asset events cannot be updated, deleted or truncated, even by the table owner', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.manager, async () => { await mk(tx, w); });
      await expectDbError(tx, /append-only/, () => tx`update asset_events set note = 'edited'`);
      await expectDbError(tx, /append-only/, () => tx`delete from asset_events`);
      await expectDbError(tx, /append-only/, () => tx`truncate asset_events`);
    });
  });

  it('assets and events have no direct write path for users; types are admin-managed', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      let id = '';
      await as(tx, w, w.manager, async () => { id = await mk(tx, w); });
      await as(tx, w, w.manager, async () => {
        await expectDbError(tx, /permission denied/, () => tx`update assets set status = 'retired' where id = ${id}`);
        await expectDbError(tx, /permission denied/, () => tx`insert into asset_events (tenant_id, asset_id, kind) values (${w.t}, ${id}, 'note')`);
        await tx`insert into asset_types (tenant_id, key, label) values (${w.t}, 'cot', 'Cot')`;
      });
      await as(tx, w, w.off1, async () => {
        await expectDbError(tx, /row-level security/, () => tx`insert into asset_types (tenant_id, key, label) values (${w.t}, 'x', 'X')`);
      });
    });
  });

  it('is tenant isolated for types, assets and events', async () => {
    await withAdmin(async (tx) => {
      const a = await world(tx);
      const b = await world(tx);
      await as(tx, b, b.manager, async () => { await mk(tx, b); });
      await as(tx, a, a.manager, async () => { await mk(tx, a); });
      await as(tx, a, a.viewer, async () => {
        for (const table of ['asset_types', 'assets', 'asset_events']) {
          const rows = await tx<{ tenant_id: string }[]>`select distinct tenant_id from ${tx(table)}`;
          expect(rows.map((r) => r.tenant_id), table).toEqual([a.t]);
        }
      });
    });
  });
});
