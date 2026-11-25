'use server';
import {
  csAdministerSchema, csCountSchema, csDiscrepancyResolveSchema, csEscalateSchema, csInvestigateSchema, csMoveSchema, csReceiveSchema,
  csSealBreakSchema, csSealSchema, csWasteSchema,
} from '@soma/validators';
import { z } from 'zod';
import type { ActionResult } from '@/server/actions';
import { ActionError, runScoped, zodFieldErrors } from '@/server/actions';
import type { Tx } from '@/server/db';

const REC = ['custody.record'] as const;
const WIT = ['custody.witness'] as const;
const MAN = ['custody.manage'] as const;
const witnessField = z.uuid('Choose who will witness');
const f = (form: FormData, k: string) => form.get(k) ?? undefined;

/** Creates the witness request for a payload; the witness confirms from their own session. */
async function requestWitness(tx: Tx, action: string, payload: Record<string, unknown>, location: string, witnessId: string): Promise<void> {
  await tx`select app.request_cs_witness(${action}, ${tx.json(payload as never)}, ${location}::uuid, ${witnessId}::uuid)`;
}
const ASKED = 'Witness requested. When they confirm, complete it under Witness requests.';

export async function receiveCs(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = csReceiveSchema.safeParse({ locationId: form.get('locationId'), lotId: form.get('lotId'), qty: form.get('qty'), reference: f(form, 'reference') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped([...REC], async (tx) => {
    await tx`select app.cs_receive(${v.locationId}::uuid, ${v.lotId}::uuid, ${v.qty}::numeric, ${v.reference}::text)`;
    return `Received ${v.qty}`;
  });
}

export async function administerCs(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = csAdministerSchema.safeParse({ locationId: form.get('locationId'), lotId: form.get('lotId'), qty: form.get('qty'), reference: form.get('reference') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped([...REC], async (tx) => {
    await tx`select app.cs_administer(${v.locationId}::uuid, ${v.lotId}::uuid, ${v.qty}::numeric, ${v.reference}::text)`;
    return `Recorded ${v.qty} administered`;
  });
}

/** Transfer or return. With a witness chosen it asks for witnessing; without one it tries directly (the database says when a witness is required). */
export async function moveCs(kind: 'transfer' | 'return', _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = csMoveSchema.safeParse({ fromId: form.get('fromId'), toId: form.get('toId'), lotId: form.get('lotId'), qty: form.get('qty'), note: f(form, 'note') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const witness = z.uuid().safeParse(form.get('witnessId'));
  const v = parsed.data;
  return runScoped([...REC], async (tx) => {
    if (witness.success) {
      await requestWitness(tx, kind, { from: v.fromId, to: v.toId, lot: v.lotId, qty: v.qty }, v.fromId, witness.data);
      return ASKED;
    }
    const fn = kind === 'return' ? tx`select app.cs_return(${v.fromId}::uuid, ${v.toId}::uuid, ${v.lotId}::uuid, ${v.qty}::numeric, ${v.note}::text, ${null}::uuid)`
      : tx`select app.cs_transfer(${v.fromId}::uuid, ${v.toId}::uuid, ${v.lotId}::uuid, ${v.qty}::numeric, ${v.note}::text, ${null}::uuid)`;
    await fn;
    return kind === 'return' ? 'Return recorded' : 'Transfer recorded';
  });
}

export async function requestWaste(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = csWasteSchema.safeParse({ locationId: form.get('locationId'), lotId: form.get('lotId'), qty: form.get('qty'), reason: form.get('reason') });
  const witness = witnessField.safeParse(form.get('witnessId'));
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  if (!witness.success) return zodFieldErrors(witness.error.issues.map((i) => ({ ...i, path: ['witnessId'] })));
  const v = parsed.data;
  return runScoped([...REC], async (tx) => {
    await requestWitness(tx, 'waste', { location: v.locationId, lot: v.lotId, qty: v.qty, reason: v.reason }, v.locationId, witness.data);
    return ASKED;
  });
}

export async function applySeal(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = csSealSchema.safeParse({ locationId: form.get('locationId'), sealNo: form.get('sealNo') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped([...REC, ...MAN], async (tx) => {
    await tx`select app.apply_cs_seal(${v.locationId}::uuid, ${v.sealNo})`;
    return `Seal ${v.sealNo} applied`;
  });
}

export async function verifySeal(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = csSealSchema.safeParse({ locationId: form.get('locationId'), sealNo: form.get('sealNo') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped([...REC], async (tx) => {
    const [r] = await tx<{ ok: boolean }[]>`select app.verify_cs_seal(${v.locationId}::uuid, ${v.sealNo}) as ok`;
    return r?.ok ? 'The seal number matches.' : 'The seal number does NOT match the box. Report it.';
  });
}

export async function requestSealBreak(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = csSealBreakSchema.safeParse({ locationId: form.get('locationId'), reason: form.get('reason'), newSealNo: form.get('newSealNo') });
  const witness = witnessField.safeParse(form.get('witnessId'));
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  if (!witness.success) return zodFieldErrors(witness.error.issues.map((i) => ({ ...i, path: ['witnessId'] })));
  const v = parsed.data;
  return runScoped([...REC, ...MAN], async (tx) => {
    await requestWitness(tx, 'seal_break', { location: v.locationId, new_seal_no: v.newSealNo, reason: v.reason }, v.locationId, witness.data);
    return ASKED;
  });
}

/** The count form posts `count:<lotId>` fields; the witness request carries exactly those lines. */
export async function requestCount(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const lines = [...form.entries()].filter(([k]) => k.startsWith('count:')).map(([k, v]) => ({ lotId: k.slice(6), counted: v }));
  const parsed = csCountSchema.safeParse({ locationId: form.get('locationId'), lines, sealNo: f(form, 'sealNo') });
  const witness = witnessField.safeParse(form.get('witnessId'));
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  if (!witness.success) return zodFieldErrors(witness.error.issues.map((i) => ({ ...i, path: ['witnessId'] })));
  const v = parsed.data;
  return runScoped([...REC], async (tx) => {
    const payload: Record<string, unknown> = { location: v.locationId, lines: v.lines.map((l) => ({ lot_id: l.lotId, counted: l.counted })) };
    if (v.sealNo) payload.seal = v.sealNo;
    await requestWitness(tx, 'count', payload, v.locationId, witness.data);
    return ASKED;
  });
}

// ---------------------------------------------------------------- witness side
export async function confirmWitness(id: string): Promise<ActionResult> {
  return runScoped([...WIT], async (tx) => {
    await tx`select app.confirm_cs_witness(${id}::uuid)`;
    return 'Confirmed. The requester can complete it now.';
  });
}

export async function declineWitness(id: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  return runScoped([...WIT], async (tx) => {
    await tx`select app.decline_cs_witness(${id}::uuid, ${String(form.get('reason') ?? '')})`;
    return 'Declined.';
  });
}

type Payload = Record<string, unknown> & { lines?: unknown };
const s = (v: unknown) => String(v ?? '');

/** The requester completes a confirmed request: the stored details are used exactly as the witness saw them. */
export async function completeWitnessed(id: string): Promise<ActionResult> {
  return runScoped([...REC, ...MAN], async (tx) => {
    const [r] = await tx<{ action: string; payload: Payload }[]>`select action, payload from cs_witness_requests where id = ${id}::uuid`;
    if (!r) throw new ActionError('That request was not found.');
    const p = r.payload;
    switch (r.action) {
      case 'waste':
        await tx`select app.cs_waste(${s(p.location)}::uuid, ${s(p.lot)}::uuid, ${s(p.qty)}::numeric, ${s(p.reason)}::text, ${id}::uuid)`;
        return 'Waste recorded with your witness.';
      case 'transfer':
        await tx`select app.cs_transfer(${s(p.from)}::uuid, ${s(p.to)}::uuid, ${s(p.lot)}::uuid, ${s(p.qty)}::numeric, ${null}::text, ${id}::uuid)`;
        return 'Transfer recorded.';
      case 'return':
        await tx`select app.cs_return(${s(p.from)}::uuid, ${s(p.to)}::uuid, ${s(p.lot)}::uuid, ${s(p.qty)}::numeric, ${null}::text, ${id}::uuid)`;
        return 'Return recorded.';
      case 'seal_break':
        await tx`select app.break_cs_seal(${s(p.location)}::uuid, ${s(p.reason)}::text, ${s(p.new_seal_no)}::text, ${id}::uuid)`;
        return 'Seal broken and the new seal applied.';
      case 'count':
        await tx`select app.submit_cs_count(${s(p.location)}::uuid, ${tx.json(p.lines as never)}, ${p.seal ? s(p.seal) : null}::text, ${null}::uuid, ${id}::uuid)`;
        return 'Count submitted.';
      case 'adjust':
        if (p.discrepancy) {
          await tx`select app.resolve_cs_discrepancy(${s(p.discrepancy)}::uuid, ${s(p.reason)}::text, ${s(p.delta)}::numeric, ${id}::uuid)`;
          return 'Discrepancy resolved with a witnessed adjustment.';
        }
        await tx`select app.cs_adjust(${s(p.location)}::uuid, ${s(p.lot)}::uuid, ${s(p.delta)}::numeric, ${s(p.reason)}::text, ${id}::uuid)`;
        return 'Adjustment recorded.';
      default:
        throw new ActionError('Unknown request.');
    }
  });
}

// ---------------------------------------------------------------- discrepancies
export async function investigateDiscrepancy(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = csInvestigateSchema.safeParse({ id: form.get('id'), note: form.get('note') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  return runScoped([...MAN], async (tx) => {
    await tx`select app.investigate_cs_discrepancy(${parsed.data.id}::uuid, ${parsed.data.note})`;
    return 'Noted as under investigation.';
  });
}

export async function escalateDiscrepancy(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = csEscalateSchema.safeParse({ id: form.get('id'), note: form.get('note'), reportRef: f(form, 'reportRef') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped([...MAN], async (tx) => {
    await tx`select app.escalate_cs_discrepancy(${v.id}::uuid, ${v.note}, ${v.reportRef}::text)`;
    return 'Escalated. Nothing was filed outside SomaOS.';
  });
}

/** Without an adjustment it resolves now; with one it asks a witness first (completed from the requests list). */
export async function resolveDiscrepancy(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = csDiscrepancyResolveSchema.safeParse({ id: form.get('id'), note: form.get('note'), adjustDelta: f(form, 'adjustDelta') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  const witness = z.uuid().safeParse(form.get('witnessId'));
  return runScoped([...MAN], async (tx) => {
    if (v.adjustDelta === undefined) {
      await tx`select app.resolve_cs_discrepancy(${v.id}::uuid, ${v.note}, ${null}::numeric, ${null}::uuid)`;
      return 'Resolved.';
    }
    if (!witness.success) throw new ActionError('Choose who will witness the adjustment.');
    const [d] = await tx<{ location_id: string; lot_id: string | null }[]>`select location_id, lot_id from cs_discrepancies where id = ${v.id}::uuid`;
    if (!d?.lot_id) throw new ActionError('Only a quantity discrepancy can be adjusted.');
    await requestWitness(tx, 'adjust', { location: d.location_id, lot: d.lot_id, delta: v.adjustDelta, reason: v.note, discrepancy: v.id }, d.location_id, witness.data);
    return ASKED;
  });
}
