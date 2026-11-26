import type { Tx } from '../src/test-harness';
import { asUser } from '../src/test-harness';
import { createMember, createOrgUnit, createRole, createTenant, grantRole, userInTenant } from './helpers';

export async function person(tx: Tx, t: string, perms: string[], scope?: Parameters<typeof grantRole>[4]) {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u });
  if (perms.length) await grantRole(tx, t, m, await createRole(tx, t, `r_${m.slice(0, 6)}_${perms.join('').length}`, perms), scope);
  return { u, m };
}

export const as = <T>(tx: Tx, w: { t: string }, who: { u: string }, fn: () => Promise<T>) =>
  asUser(tx, { sub: who.u, tenant_id: w.t }, fn);

/** A department with two stations, controlled-substance catalog rows and the usual cast. Rows are created as the database owner. */
export async function csWorld(tx: Tx) {
  const t = await createTenant(tx);
  const s1 = await createOrgUnit(tx, t, 'Station 1');
  const s2 = await createOrgUnit(tx, t, 'Station 2');
  const loc = async (name: string, kind: string, unit: string, member: string | null = null) =>
    (await tx<{ id: string }[]>`insert into cs_locations (tenant_id, name, kind, org_unit_id, member_id) values (${t}, ${name}, ${kind}, ${unit}, ${member}) returning id`)[0]!.id;
  const [item] = await tx<{ id: string }[]>`insert into cs_items (tenant_id, name, schedule, unit) values (${t}, 'Morphine 10 mg/mL', 'II', 'mL') returning id`;
  const lot = async (no: string, expires: string) =>
    (await tx<{ id: string }[]>`insert into cs_lots (tenant_id, item_id, lot_no, expires_on) values (${t}, ${item!.id}, ${no}, ${expires}::date) returning id`)[0]!.id;
  const vault = await loc('Vault', 'vault', s1);
  const box1 = await loc('Medic 1 box', 'drug_box', s1);
  const box2 = await loc('Medic 2 box', 'drug_box', s2);
  const lotA = await lot('A100', '2099-01-01');
  const lotB = await lot('B200', '2099-06-01');

  const recorder = await person(tx, t, ['custody.record'], { scopeKind: 'org_unit', orgUnitId: s1 });
  const recorder2 = await person(tx, t, ['custody.record'], { scopeKind: 'org_unit', orgUnitId: s1 });
  const recorderElsewhere = await person(tx, t, ['custody.record'], { scopeKind: 'org_unit', orgUnitId: s2 });
  const witness = await person(tx, t, ['custody.witness'], { scopeKind: 'org_unit', orgUnitId: s1 });
  const witnessElsewhere = await person(tx, t, ['custody.witness'], { scopeKind: 'org_unit', orgUnitId: s2 });
  const both = await person(tx, t, ['custody.record', 'custody.witness'], { scopeKind: 'org_unit', orgUnitId: s1 });
  const auditor = await person(tx, t, ['custody.audit']);
  const manager = await person(tx, t, ['custody.manage']);
  const manager1 = await person(tx, t, ['custody.manage'], { scopeKind: 'org_unit', orgUnitId: s1 });
  const nobody = await person(tx, t, []);
  return { t, s1, s2, item: item!.id, lotA, lotB, vault, box1, box2, recorder, recorder2, recorderElsewhere, witness, witnessElsewhere, both, auditor, manager, manager1, nobody };
}
export type CsWorld = Awaited<ReturnType<typeof csWorld>>;

type Who = { u: string; m: string };

/** Puts stock in a location as the database owner so a scenario starts from a known balance (the chain trigger still runs). */
export async function stock(tx: Tx, w: CsWorld, location: string, lot: string, qty: number) {
  await tx`insert into cs_ledger (tenant_id, location_id, lot_id, delta, type, performed_by, reason) values (${w.t}, ${location}, ${lot}, ${qty}, 'receive', ${w.manager.m}, 'seed')`;
}

export const onHand = async (tx: Tx, location: string, lot: string) =>
  Number((await tx<{ s: string | null }[]>`select sum(delta) as s from cs_ledger where location_id = ${location} and lot_id = ${lot}`)[0]!.s ?? 0);

/** The requester asks and the witness confirms from their own session; returns the request id. */
export async function witnessed(tx: Tx, w: CsWorld, requester: Who, witness: Who, action: string, payload: object, location: string): Promise<string> {
  let id = '';
  await as(tx, w, requester, async () => {
    id = (await tx<{ id: string }[]>`select app.request_cs_witness(${action}, ${tx.json(payload as never)}, ${location}, ${witness.m}) as id`)[0]!.id;
  });
  await as(tx, w, witness, async () => { await tx`select app.confirm_cs_witness(${id})`; });
  return id;
}
