import 'server-only';
import type { Tx } from '@/server/db';

export type Balance = { locationId: string; lotId: string; onHand: number };
export type LedgerRow = { id: string; type: string; delta: number; lotNo: string; itemName: string; by: string; witness: string | null; reference: string | null; reason: string | null; at: string; seq: number };
export type SealEvent = { id: string; kind: string; sealNo: string; ok: boolean | null; reason: string | null; by: string; witness: string | null; at: string };
export type WitnessRequest = {
  id: string; action: string; payload: Record<string, unknown>; locationId: string; locationName: string;
  requestedBy: string; witness: string; status: string; expiresAt: string; expired: boolean; consumed: boolean; mine: boolean; forMe: boolean;
};

export async function loadBalances(tx: Tx, locationId?: string): Promise<Balance[]> {
  const rows = await tx<{ location_id: string; lot_id: string; on_hand: string }[]>`
    select location_id, lot_id, on_hand from cs_balances where on_hand <> 0 ${locationId ? tx`and location_id = ${locationId}` : tx``}`;
  return rows.map((r) => ({ locationId: r.location_id, lotId: r.lot_id, onHand: Number(r.on_hand) }));
}

/** The newest movements first, with the members' names. Bounded: the location's chain index is used and the limit applies early. */
export async function loadLedger(tx: Tx, locationId: string, limit = 100): Promise<LedgerRow[]> {
  const rows = await tx<{ id: string; type: string; delta: string; lot_no: string; item_name: string; by: string; witness: string | null; reference: string | null; reason: string | null; at: string; seq: string }[]>`
    with recent as (
      select * from cs_ledger where location_id = ${locationId} order by seq desc limit ${limit}
    )
    select r.id::text, r.type, r.delta, l.lot_no, i.name as item_name,
           mb.last_name || ', ' || mb.first_name as by, case when mw.id is null then null else mw.last_name || ', ' || mw.first_name end as witness,
           r.reference, r.reason, r.occurred_at::text as at, r.seq::text
    from recent r
    join cs_lots l on l.id = r.lot_id join cs_items i on i.id = l.item_id
    join members mb on mb.id = r.performed_by left join members mw on mw.id = r.witnessed_by
    order by r.seq desc`;
  return rows.map((r) => ({ id: r.id, type: r.type, delta: Number(r.delta), lotNo: r.lot_no, itemName: r.item_name, by: r.by, witness: r.witness, reference: r.reference, reason: r.reason, at: r.at, seq: Number(r.seq) }));
}

/** null when the caller may not run the check (only audit and manage can). */
export async function chainStatus(tx: Tx, locationId: string): Promise<{ ok: boolean; brokenSeq: number | null } | null> {
  try {
    const [r] = await tx<{ ok: boolean; broken_seq: string | null }[]>`select * from app.verify_cs_chain(${locationId})`;
    return r ? { ok: r.ok, brokenSeq: r.broken_seq === null ? null : Number(r.broken_seq) } : null;
  } catch {
    return null;
  }
}

export async function loadSealEvents(tx: Tx, locationId: string): Promise<SealEvent[]> {
  const rows = await tx<{ id: string; kind: string; seal_no: string; ok: boolean | null; reason: string | null; by: string; witness: string | null; at: string }[]>`
    select e.id, e.kind, e.seal_no, e.ok, e.reason, mb.last_name || ', ' || mb.first_name as by,
           case when mw.id is null then null else mw.last_name || ', ' || mw.first_name end as witness, e.occurred_at::text as at
    from cs_seal_events e join members mb on mb.id = e.performed_by left join members mw on mw.id = e.witnessed_by
    where e.location_id = ${locationId} order by e.occurred_at desc limit 50`;
  return rows.map((r) => ({ id: r.id, kind: r.kind, sealNo: r.seal_no, ok: r.ok, reason: r.reason, by: r.by, witness: r.witness, at: r.at }));
}

export async function loadWitnessCandidates(tx: Tx, locationId: string): Promise<{ id: string; name: string }[]> {
  try {
    const rows = await tx<{ member_id: string; name: string }[]>`select member_id, name from app.cs_witness_candidates(${locationId})`;
    return rows.map((r) => ({ id: r.member_id, name: r.name }));
  } catch {
    return [];
  }
}

/** Requests I made or was asked to witness, newest first. */
export async function loadWitnessRequests(tx: Tx): Promise<WitnessRequest[]> {
  const me = (await tx<{ id: string | null }[]>`select app.my_member_id() as id`)[0]?.id ?? null;
  const rows = await tx<{
    id: string; action: string; payload: Record<string, unknown>; location_id: string; location_name: string; requested_by: string; requested_by_id: string;
    witness: string; witness_id: string; status: string; expires_at: string; expired: boolean; consumed: boolean;
  }[]>`
    select r.id, r.action, r.payload, r.location_id, l.name as location_name,
           mr.last_name || ', ' || mr.first_name as requested_by, r.requested_by as requested_by_id,
           mw.last_name || ', ' || mw.first_name as witness, r.witness_member_id as witness_id,
           r.status, r.expires_at::text, r.expires_at <= now() as expired, r.consumed_at is not null as consumed
    from cs_witness_requests r join cs_locations l on l.id = r.location_id
    join members mr on mr.id = r.requested_by join members mw on mw.id = r.witness_member_id
    where r.requested_by = app.my_member_id() or r.witness_member_id = app.my_member_id()
    order by r.created_at desc limit 50`;
  return rows.map((r) => ({
    id: r.id, action: r.action, payload: r.payload, locationId: r.location_id, locationName: r.location_name, requestedBy: r.requested_by, witness: r.witness,
    status: r.status, expiresAt: r.expires_at, expired: r.expired, consumed: r.consumed, mine: r.requested_by_id === me, forMe: r.witness_id === me,
  }));
}
