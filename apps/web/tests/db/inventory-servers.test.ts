import { afterAll, describe, expect, it } from 'vitest';
import { asUser, closeTestDb, withAdmin, type Tx } from '@soma/db/src/test-harness';
import { friendlyDbError } from '@/server/actions';
import { loadAsset, loadAssets, loadAssetTypes } from '@/server/inventory/assets';
import { loadCompletions, loadTemplates } from '@/server/inventory/checklists';
import { loadItems, loadLevels, loadLocations, loadLowStock } from '@/server/inventory/stock';

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

const asAdmin = <T>(tx: Tx, d: Demo, fn: () => Promise<T>) => asUser(tx, { sub: d.adminId, tenant_id: d.tenantId }, fn);
const asMember = <T>(tx: Tx, d: Demo, fn: () => Promise<T>) => asUser(tx, { sub: d.memberUserId, tenant_id: d.tenantId }, fn);

describe('starter pack and loaders', () => {
  it('a new department gets the starter asset types, checklists, items and a storeroom', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await asMember(tx, d, async () => {
        expect((await loadAssetTypes(tx)).map((t) => t.key)).toEqual(
          expect.arrayContaining(['apparatus', 'cardiac_monitor', 'cot', 'ballistic_vest', 'turnout_gear', 'equipment']),
        );
        const templates = await loadTemplates(tx);
        expect(templates.map((t) => t.key).sort()).toEqual(['daily_truck_check', 'drug_inventory']);
        expect(templates.find((t) => t.key === 'daily_truck_check')!.assetTypeLabel).toMatch(/Apparatus/);
        expect((await loadItems(tx)).length).toBeGreaterThan(3);
        expect((await loadLocations(tx)).map((l) => l.path)).toContain('Main storeroom');
      });
    });
  });

  it('a member can complete the truck check on an asset and the history, completion and level views line up', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      const [unit] = await tx<{ id: string }[]>`select id from org_units where tenant_id = ${d.tenantId} order by path limit 1`;
      const [type] = await tx<{ id: string }[]>`select id from asset_types where tenant_id = ${d.tenantId} and key = 'apparatus'`;
      const [member] = await tx<{ id: string }[]>`select m.id from members m where m.user_id = ${d.memberUserId} and m.tenant_id = ${d.tenantId}`;
      let assetId = '';
      await asAdmin(tx, d, async () => {
        const [a] = await tx<{ id: string }[]>`select app.create_asset(${type!.id}, 'Engine 1', 'E-1', ${unit!.id}, '{}'::jsonb) as id`;
        assetId = a!.id;
      });
      // The member needs a grant at the station to complete a check there (the demo member has the starter role).
      await tx`insert into role_grants (tenant_id, member_id, role_id, scope_kind, scope_org_unit_id)
               select ${d.tenantId}, ${member!.id}, r.id, 'org_unit', ${unit!.id} from roles r where r.tenant_id = ${d.tenantId} and r.key = 'member'
               and not exists (select 1 from role_grants g where g.member_id = ${member!.id} and g.role_id = r.id and g.scope_kind = 'org_unit')`;
      await asMember(tx, d, async () => {
        const [tpl] = (await loadTemplates(tx)).filter((t) => t.key === 'daily_truck_check');
        const answers = Object.fromEntries(tpl!.items.filter((i) => i.required).map((i) => [i.key, i.kind === 'pass_fail' ? 'pass' : i.kind === 'number' ? 1 : 'x']));
        answers.exterior = 'fail';
        await tx`select app.complete_checklist(${tpl!.id}, ${assetId}, ${tx.json(answers as never)}, null)`;
        const [done] = await loadCompletions(tx, { assetId });
        expect(done).toMatchObject({ failedCount: 1, assetName: 'Engine 1', completedBy: 'Medic, Riley' });
        const found = await loadAsset(tx, assetId);
        expect(found!.asset.status).toBe('in_service');
        expect(found!.events.map((e) => e.kind)).toEqual(['check', 'note']);
        expect((await loadAssets(tx, { status: 'out_of_service' })).length).toBe(0);
      });
    });
  });

  it('stock levels and low-stock rows come back as numbers', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await asAdmin(tx, d, async () => {
        const [loc] = await loadLocations(tx);
        const [item] = await loadItems(tx);
        await tx`select app.set_par(${loc!.id}, ${item!.id}, 10, 2)`;
        await tx`select app.receive_stock(${loc!.id}, ${item!.id}, 4, '{}'::jsonb)`;
        const levels = await loadLevels(tx, loc!.id);
        expect(levels.find((l) => l.itemId === item!.id)).toMatchObject({ onHand: 4, par: 10, min: 2 });
        expect(await loadLowStock(tx)).toContainEqual({ locationId: loc!.id, itemId: item!.id, onHand: 4, par: 10, shortBy: 6, critical: false });
      });
    });
  });
});

describe('error mapping', () => {
  it('shows the database’s plain-English messages for inventory problems', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      const [loc] = await tx<{ id: string }[]>`select id from stock_locations where tenant_id = ${d.tenantId} limit 1`;
      const [item] = await tx<{ id: string }[]>`select id from items where tenant_id = ${d.tenantId} limit 1`;
      await asAdmin(tx, d, async () => {
        const message = async (fn: () => Promise<unknown>) => {
          try { await tx`savepoint s`; await fn(); } catch (e) { await tx`rollback to savepoint s`; return friendlyDbError(e); }
          return 'no error';
        };
        expect(await message(() => tx`select app.use_stock(${loc!.id}, ${item!.id}, 5, null)`)).toBe('Not enough stock: only 0 on hand');
        expect(await message(() => tx`select app.adjust_stock(${loc!.id}, ${item!.id}, 3, 'no')`)).toBe('Explain the adjustment (at least 5 characters)');
        expect(await message(() => tx`select app.use_stock(${loc!.id}, ${item!.id}, 0, null)`)).toBe('Enter a quantity above zero');
      });
    });
  });
});
