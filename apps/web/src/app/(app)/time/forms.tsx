'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { addTimeEntry, voidTimeEntry } from './actions';

type Opt = { id: string; label: string };
const TYPES = [
  ['holdover', 'Holdover'], ['callback', 'Callback'], ['overtime', 'Overtime'], ['regular', 'Regular'], ['trade', 'Trade'],
  ['acting', 'Acting'], ['training', 'Training'], ['detail', 'Detail'],
] as const;

export function AddTimeForm({ members, today }: { members: Opt[]; today: string }) {
  return (
    <ActionForm action={addTimeEntry} label="Record time" submitLabel="Record time" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="te-member" label="Member" error={e.memberId}>
            <Select id="te-member" name="memberId" required>{members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select>
          </Field>
          <Field id="te-date" label="Date worked" error={e.workDate}><Input id="te-date" name="workDate" type="date" defaultValue={today} required /></Field>
          <Field id="te-hours" label="Hours" error={e.hours}><Input id="te-hours" name="hours" type="number" step="0.25" min="0.25" max="48" inputMode="decimal" required /></Field>
          <Field id="te-type" label="Type" error={e.type}>
            <Select id="te-type" name="type" defaultValue="holdover">{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          </Field>
          <div className="sm:col-span-2">
            <Field id="te-reason" label="Reason" hint="What happened, e.g. “Held over for a late call”." error={e.reason}><Input id="te-reason" name="reason" required /></Field>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function VoidTimeForm({ id, label }: { id: string; label: string }) {
  return (
    <ActionForm action={voidTimeEntry.bind(null, id)} label={`Void ${label}`} submitLabel="Void" submitVariant="secondary" className="mt-2 space-y-2">
      {(e) => (
        <Field id={`void-${id}`} label="Why is it void?" error={e.reason}><Input id={`void-${id}`} name="reason" required /></Field>
      )}
    </ActionForm>
  );
}
