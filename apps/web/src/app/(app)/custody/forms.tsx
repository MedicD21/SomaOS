'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import {
  administerCs, applySeal, completeWitnessed, confirmWitness, declineWitness, escalateDiscrepancy, investigateDiscrepancy, moveCs, receiveCs,
  requestCount, requestSealBreak, requestWaste, resolveDiscrepancy, verifySeal,
} from './actions';

type Opt = { id: string; label: string };
const qty = { type: 'number', step: '0.001', min: '0.001', inputMode: 'decimal' as const };

function Hidden({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}

function WitnessSelect({ id, witnesses, optional = false, error }: { id: string; witnesses: Opt[]; optional?: boolean; error?: string }) {
  return (
    <Field id={id} label={optional ? 'Witness (if needed)' : 'Witness'} hint={witnesses.length === 0 ? 'No other member with witness permission covers this location.' : 'They confirm from their own sign-in.'} error={error}>
      <Select id={id} name="witnessId" required={!optional} defaultValue="">
        <option value="">{optional ? 'No witness' : 'Choose a witness'}</option>
        {witnesses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
      </Select>
    </Field>
  );
}

export function ReceiveForm({ locationId, lots }: { locationId: string; lots: Opt[] }) {
  return (
    <ActionForm action={receiveCs} label="Receive stock" submitLabel="Receive" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Hidden name="locationId" value={locationId} />
          <Field id="rc-lot" label="Lot" error={e.lotId}><Select id="rc-lot" name="lotId" required>{lots.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select></Field>
          <Field id="rc-qty" label="Quantity" error={e.qty}><Input id="rc-qty" name="qty" required {...qty} /></Field>
          <div className="sm:col-span-2"><Field id="rc-ref" label="Reference (optional)" hint="Where it came from, for example a delivery number." error={e.reference}><Input id="rc-ref" name="reference" maxLength={200} /></Field></div>
        </div>
      )}
    </ActionForm>
  );
}

export function AdministerForm({ locationId, lots }: { locationId: string; lots: Opt[] }) {
  return (
    <ActionForm action={administerCs} label="Record administered" submitLabel="Record administered" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Hidden name="locationId" value={locationId} />
          <Field id="ad-lot" label="Lot" error={e.lotId}><Select id="ad-lot" name="lotId" required>{lots.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select></Field>
          <Field id="ad-qty" label="Quantity given" error={e.qty}><Input id="ad-qty" name="qty" required {...qty} /></Field>
          <div className="sm:col-span-2">
            <Field id="ad-ref" label="Incident or run number" hint="A number only. Never a patient name or other identifier." error={e.reference}><Input id="ad-ref" name="reference" required maxLength={200} /></Field>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function MoveForm({ kind, fromId, locations, lots, witnesses }: { kind: 'transfer' | 'return'; fromId: string; locations: Opt[]; lots: Opt[]; witnesses: Opt[] }) {
  const label = kind === 'return' ? 'Return stock' : 'Transfer stock';
  return (
    <ActionForm action={moveCs.bind(null, kind)} label={label} submitLabel={label} resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Hidden name="fromId" value={fromId} />
          <Field id={`${kind}-to`} label="To" error={e.toId}><Select id={`${kind}-to`} name="toId" required>{locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select></Field>
          <Field id={`${kind}-lot`} label="Lot" error={e.lotId}><Select id={`${kind}-lot`} name="lotId" required>{lots.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select></Field>
          <Field id={`${kind}-qty`} label="Quantity" error={e.qty}><Input id={`${kind}-qty`} name="qty" required {...qty} /></Field>
          <WitnessSelect id={`${kind}-wit`} witnesses={witnesses} optional error={e.witnessId} />
          <p className="text-sm text-muted sm:col-span-2">Moving into or out of a drug box or a member needs a witness.</p>
        </div>
      )}
    </ActionForm>
  );
}

export function WasteForm({ locationId, lots, witnesses }: { locationId: string; lots: Opt[]; witnesses: Opt[] }) {
  return (
    <ActionForm action={requestWaste} label="Waste" submitLabel="Ask a witness" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Hidden name="locationId" value={locationId} />
          <Field id="ws-lot" label="Lot" error={e.lotId}><Select id="ws-lot" name="lotId" required>{lots.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select></Field>
          <Field id="ws-qty" label="Quantity wasted" error={e.qty}><Input id="ws-qty" name="qty" required {...qty} /></Field>
          <div className="sm:col-span-2"><Field id="ws-reason" label="Reason" error={e.reason}><Input id="ws-reason" name="reason" required maxLength={500} /></Field></div>
          <WitnessSelect id="ws-wit" witnesses={witnesses} error={e.witnessId} />
        </div>
      )}
    </ActionForm>
  );
}

export function SealApplyForm({ locationId }: { locationId: string }) {
  return (
    <ActionForm action={applySeal} label="Apply a seal" submitLabel="Apply seal" resetOnSuccess>
      {(e) => (<><Hidden name="locationId" value={locationId} /><Field id="sa-no" label="New seal number" error={e.sealNo}><Input id="sa-no" name="sealNo" required maxLength={60} /></Field></>)}
    </ActionForm>
  );
}

export function SealVerifyForm({ locationId }: { locationId: string }) {
  return (
    <ActionForm action={verifySeal} label="Check the seal" submitLabel="Check seal" submitVariant="secondary" resetOnSuccess>
      {(e) => (<><Hidden name="locationId" value={locationId} /><Field id="sv-no" label="Seal number you see" error={e.sealNo}><Input id="sv-no" name="sealNo" required maxLength={60} /></Field></>)}
    </ActionForm>
  );
}

export function SealBreakForm({ locationId, witnesses }: { locationId: string; witnesses: Opt[] }) {
  return (
    <ActionForm action={requestSealBreak} label="Break the seal" submitLabel="Ask a witness" submitVariant="secondary" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Hidden name="locationId" value={locationId} />
          <Field id="sb-reason" label="Why is it being broken?" error={e.reason}><Input id="sb-reason" name="reason" required maxLength={500} /></Field>
          <Field id="sb-new" label="New seal number" error={e.newSealNo}><Input id="sb-new" name="newSealNo" required maxLength={60} /></Field>
          <WitnessSelect id="sb-wit" witnesses={witnesses} error={e.witnessId} />
        </div>
      )}
    </ActionForm>
  );
}

export type SheetOpt = { lotId: string; label: string };

/** The blind count: a quantity box per lot, no expected numbers. */
export function CountForm({ locationId, sheet, witnesses, hasSeal }: { locationId: string; sheet: SheetOpt[]; witnesses: Opt[]; hasSeal: boolean }) {
  return (
    <ActionForm action={requestCount} label="Count" submitLabel="Ask a witness to confirm the count" resetOnSuccess>
      {(e) => (
        <div className="space-y-3">
          <Hidden name="locationId" value={locationId} />
          <ul aria-label="Lots to count" className="space-y-2">
            {sheet.map((l) => (
              <li key={l.lotId} className="grid items-end gap-2 sm:grid-cols-2">
                <label htmlFor={`cnt-${l.lotId}`} className="text-sm font-medium">{l.label}</label>
                <Input id={`cnt-${l.lotId}`} name={`count:${l.lotId}`} required type="number" step="0.001" min="0" inputMode="decimal" aria-label={`Counted: ${l.label}`} />
              </li>
            ))}
          </ul>
          {e.lines && <p className="text-sm text-danger">{e.lines}</p>}
          {hasSeal && <Field id="cnt-seal" label="Seal number you see" error={e.sealNo}><Input id="cnt-seal" name="sealNo" required maxLength={60} /></Field>}
          <WitnessSelect id="cnt-wit" witnesses={witnesses} error={e.witnessId} />
        </div>
      )}
    </ActionForm>
  );
}

// ---------------------------------------------------------------- witness requests
export function ConfirmWitnessForm({ id, label }: { id: string; label: string }) {
  return <ActionForm action={confirmWitness.bind(null, id)} label={`Confirm ${label}`} submitLabel="Confirm I witnessed this" className="space-y-2" />;
}

export function DeclineWitnessForm({ id, label }: { id: string; label: string }) {
  return (
    <ActionForm action={declineWitness.bind(null, id)} label={`Decline ${label}`} submitLabel="Decline" submitVariant="secondary" className="space-y-2">
      <Field id={`dw-${id}`} label="Reason (optional)"><Input id={`dw-${id}`} name="reason" maxLength={200} /></Field>
    </ActionForm>
  );
}

export function CompleteWitnessedForm({ id, label }: { id: string; label: string }) {
  return <ActionForm action={completeWitnessed.bind(null, id)} label={`Complete ${label}`} submitLabel="Complete" className="space-y-2" />;
}

// ---------------------------------------------------------------- discrepancies
export function InvestigateForm({ id, label }: { id: string; label: string }) {
  return (
    <ActionForm action={investigateDiscrepancy} label={`Investigate ${label}`} submitLabel="Add investigation note" submitVariant="secondary" resetOnSuccess>
      {(e) => (<><Hidden name="id" value={id} /><Field id={`inv-${id}`} label="What are you looking into?" error={e.note}><Input id={`inv-${id}`} name="note" required maxLength={500} /></Field></>)}
    </ActionForm>
  );
}

export function EscalateForm({ id, label }: { id: string; label: string }) {
  return (
    <ActionForm action={escalateDiscrepancy} label={`Escalate ${label}`} submitLabel="Escalate" submitVariant="secondary" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Hidden name="id" value={id} />
          <Field id={`esc-${id}`} label="Why escalate?" error={e.note}><Input id={`esc-${id}`} name="note" required maxLength={500} /></Field>
          <Field id={`escr-${id}`} label="Report reference (optional)" hint="Free text. Nothing is filed for you." error={e.reportRef}><Input id={`escr-${id}`} name="reportRef" maxLength={200} /></Field>
        </div>
      )}
    </ActionForm>
  );
}

export function ResolveForm({ id, label, witnesses, canAdjust }: { id: string; label: string; witnesses: Opt[]; canAdjust: boolean }) {
  return (
    <ActionForm action={resolveDiscrepancy} label={`Resolve ${label}`} submitLabel="Resolve" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Hidden name="id" value={id} />
          <div className="sm:col-span-2"><Field id={`res-${id}`} label="How was it resolved?" hint="At least 10 characters." error={e.note}><Input id={`res-${id}`} name="note" required maxLength={500} /></Field></div>
          {canAdjust && (
            <>
              <Field id={`resd-${id}`} label="Adjust the balance by (optional)" hint="Negative to remove. An adjustment needs a witness." error={e.adjustDelta}><Input id={`resd-${id}`} name="adjustDelta" type="number" step="0.001" inputMode="decimal" /></Field>
              <WitnessSelect id={`resw-${id}`} witnesses={witnesses} optional error={e.witnessId} />
            </>
          )}
        </div>
      )}
    </ActionForm>
  );
}
