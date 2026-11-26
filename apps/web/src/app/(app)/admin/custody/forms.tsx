'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { CS_LOCATION_KINDS, CS_UNITS } from '@soma/validators';
import { addCsItem, addCsLocation, addCsLot, archiveCsLocation, archiveCsLot, recallCsLot } from './actions';

type Opt = { id: string; label: string };

export function AddItemForm() {
  return (
    <ActionForm action={addCsItem} label="Add medication" submitLabel="Add medication" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ci-name" label="Name and strength" error={e.name}><Input id="ci-name" name="name" required maxLength={120} /></Field>
          <Field id="ci-sched" label="Schedule" hint="For example II. A label only." error={e.schedule}><Input id="ci-sched" name="schedule" required maxLength={12} /></Field>
          <Field id="ci-unit" label="Unit" error={e.unit}><Select id="ci-unit" name="unit" defaultValue="mL">{CS_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</Select></Field>
          <Field id="ci-ndc" label="NDC (optional)" error={e.ndc}><Input id="ci-ndc" name="ndc" maxLength={20} /></Field>
          <div className="sm:col-span-2"><Field id="ci-note" label="Note (optional)" error={e.note}><Input id="ci-note" name="note" maxLength={200} /></Field></div>
        </div>
      )}
    </ActionForm>
  );
}

export function AddLotForm({ items }: { items: Opt[] }) {
  return (
    <ActionForm action={addCsLot} label="Add lot" submitLabel="Add lot" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="cl-item" label="Medication" error={e.itemId}><Select id="cl-item" name="itemId" required>{items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</Select></Field>
          <Field id="cl-no" label="Lot number" error={e.lotNo}><Input id="cl-no" name="lotNo" required maxLength={60} /></Field>
          <Field id="cl-exp" label="Expires on" error={e.expiresOn}><Input id="cl-exp" name="expiresOn" type="date" required /></Field>
        </div>
      )}
    </ActionForm>
  );
}

export function AddLocationForm({ units, members }: { units: Opt[]; members: Opt[] }) {
  return (
    <ActionForm action={addCsLocation} label="Add custody location" submitLabel="Add location" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="cc-name" label="Name" error={e.name}><Input id="cc-name" name="name" required maxLength={120} /></Field>
          <Field id="cc-kind" label="Kind" error={e.kind}><Select id="cc-kind" name="kind" defaultValue="drug_box">{CS_LOCATION_KINDS.map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}</Select></Field>
          <Field id="cc-unit" label="Station or unit" error={e.orgUnitId}><Select id="cc-unit" name="orgUnitId" required>{units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select></Field>
          <Field id="cc-member" label="Member (member locations only)" error={e.memberId}>
            <Select id="cc-member" name="memberId" defaultValue=""><option value="">None</option>{members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select>
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function RecallForm({ lotId, label }: { lotId: string; label: string }) {
  return (
    <ActionForm action={recallCsLot} label={`Recall ${label}`} submitLabel="Flag as recalled" submitVariant="danger">
      {(e) => (<><input type="hidden" name="lotId" value={lotId} /><Field id={`rl-${lotId}`} label="Recall details" error={e.note}><Input id={`rl-${lotId}`} name="note" required maxLength={500} /></Field></>)}
    </ActionForm>
  );
}

export function ArchiveLocationForm({ id, label }: { id: string; label: string }) {
  return <ActionForm action={archiveCsLocation.bind(null, id)} label={`Archive ${label}`} submitLabel={`Archive ${label}`} submitVariant="secondary" className="mt-2 space-y-2" />;
}

export function ArchiveLotForm({ id, label }: { id: string; label: string }) {
  return <ActionForm action={archiveCsLot.bind(null, id)} label={`Archive ${label}`} submitLabel={`Archive ${label}`} submitVariant="secondary" className="mt-2 space-y-2" />;
}
