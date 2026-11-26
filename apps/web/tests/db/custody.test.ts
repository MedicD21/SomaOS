import { afterAll, describe, expect, it } from 'vitest';
import { asUser, closeTestDb, withAdmin, type Tx } from '@soma/db/src/test-harness';
import { friendlyDbError } from '@/server/actions';
import { loadCountSheet, loadExpiring } from '@/server/custody/counts';
import { loadBalances, loadLedger, loadWitnessCandidates, loadWitnessRequests } from '@/server/custody/ledger';

afterAll(() => closeTestDb());

type Demo = { tenantId: string; unitId: string; rileyUser: string; rileyId: string; danaId: string };

/** Demo Fire Rescue with a drug box holding one lot; Riley (starter "member" role) can record and witness. */
async function demo(tx: Tx) {
  const [d] = await tx<Demo[]>`
    select t.id as "tenantId", (select id from org_units where tenant_id = t.id order by path limit 1) as "unitId",
           u.id as "rileyUser", m.id as "rileyId", (select m2.id from members m2 join auth.users a on a.id = m2.user_id where a.email = 'admin@soma.local' and m2.tenant_id = t.id) as "danaId"
    from tenants t, auth.users u, members m
    where t.slug = 'demo-fire-rescue' and u.email = 'member@soma.local' and m.user_id = u.id and m.tenant_id = t.id`;
  if (!d) throw new Error('Demo Fire Rescue is not seeded; run supabase db reset && pnpm db:seed');
  const [item] = await tx<{ id: string }[]>`insert into cs_items (tenant_id, name, schedule, unit) values (${d.tenantId}, 'Test morphine', 'II', 'mL') returning id`;
  const [lot] = await tx<{ id: string }[]>`insert into cs_lots (tenant_id, item_id, lot_no, expires_on) values (${d.tenantId}, ${item!.id}, 'W1', current_date + 20) returning id`;
  const [box] = await tx<{ id: string }[]>`insert into cs_locations (tenant_id, name, kind, org_unit_id) values (${d.tenantId}, 'Test box', 'drug_box', ${d.unitId}) returning id`;
  await tx`insert into cs_ledger (tenant_id, location_id, lot_id, delta, type, performed_by, reason) values (${d.tenantId}, ${box!.id}, ${lot!.id}, 4, 'receive', ${d.danaId}, 'seed')`;
  return { ...d, lot: lot!.id, box: box!.id };
}

describe('custody loaders', () => {
  it('the count sheet lists lots by name and never carries a quantity', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await asUser(tx, { sub: d.rileyUser, tenant_id: d.tenantId }, async () => {
        const sheet = await loadCountSheet(tx, d.box);
        expect(sheet).toHaveLength(1);
        expect(sheet[0]).toEqual({ lotId: d.lot, itemName: 'Test morphine', unit: 'mL', lotNo: 'W1', expiresOn: sheet[0]!.expiresOn });
        expect(JSON.stringify(sheet)).not.toMatch(/expected|on_?hand|quantity|balance/i);
      });
    });
  });

  it('balances, ledger, expiry and witness candidates come back in scope and bounded', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await asUser(tx, { sub: d.rileyUser, tenant_id: d.tenantId }, async () => {
        expect((await loadBalances(tx, d.box)).map((b) => b.onHand)).toEqual([4]);
        const ledger = await loadLedger(tx, d.box, 10);
        expect(ledger.map((r) => [r.type, r.delta, r.seq])).toEqual([['receive', 4, 1]]);
        expect((await loadExpiring(tx, 30)).map((r) => [r.lotNo, r.daysLeft])).toEqual([['W1', 20]]);
        expect(await loadExpiring(tx, 10)).toEqual([]);
        // Riley cannot witness for himself; the starter admin has no custody permissions, so nobody qualifies yet.
        expect(await loadWitnessCandidates(tx, d.box)).toEqual([]);
        expect(await loadWitnessRequests(tx)).toEqual([]);
      });
    });
  });
});

describe('custody error messages', () => {
  it.each([
    ['Not enough on hand: 1.000 available', /^Not enough on hand/],
    ['A witness is required: request one first', /^A witness is required/],
    ['That witness request is for different details', /different details/],
    ['The counter and the witness cannot resolve their own count', /cannot resolve their own count/],
    ['only the named witness can confirm this', /named witness/],
    ['not allowed: you cannot record custody here', /cannot record custody here/],
    ['not allowed: custody.manage required at this location', /custody\.manage required/],
  ])('shows "%s" to the user as written', (raw, pattern) => {
    expect(friendlyDbError(new Error(raw))).toMatch(pattern);
  });

  it('hides unknown database errors', () => {
    expect(friendlyDbError(new Error('relation "x" does not exist'))).toBe('Something went wrong saving your change.');
  });
});
