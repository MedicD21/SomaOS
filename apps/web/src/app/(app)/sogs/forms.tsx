'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { acknowledge, assignReading } from './actions';

type Opt = { id: string; label: string };

export function AcknowledgeForm({ readingId, title, statement, requireTypedName }: { readingId: string; title: string; statement: string; requireTypedName: boolean }) {
  return (
    <ActionForm action={acknowledge.bind(null, readingId)} label={`Acknowledge ${title}`} submitLabel="Acknowledge" className="space-y-3">
      {(e) => (
        <>
          <p className="text-sm">{statement}</p>
          {requireTypedName && (
            <Field id={`ack-${readingId}`} label="Type your full name" hint="Exactly as it appears on your member record." error={e.typedName}>
              <Input id={`ack-${readingId}`} name="typedName" autoComplete="name" />
            </Field>
          )}
        </>
      )}
    </ActionForm>
  );
}

export function AssignReadingForm({ versionId, label, units, roles }: { versionId: string; label: string; units: Opt[]; roles: Opt[] }) {
  return (
    <ActionForm action={assignReading} label={`Assign reading of ${label}`} submitLabel="Assign reading" className="space-y-3">
      {(e) => (
        <>
          <input type="hidden" name="versionId" value={versionId} />
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="everyone" /> Everyone in the department</label>
          {e.everyone && <p className="text-sm text-danger">{e.everyone}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`as-units-${versionId}`} label="Or these stations and units" hint="Hold Ctrl or Cmd to choose several.">
              <Select id={`as-units-${versionId}`} name="orgUnitIds" multiple size={4}>{units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select>
            </Field>
            <Field id={`as-roles-${versionId}`} label="And people with these roles">
              <Select id={`as-roles-${versionId}`} name="roleIds" multiple size={4}>{roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</Select>
            </Field>
            <Field id={`as-due-${versionId}`} label="Due date (optional)" hint="Blank means 14 days from now." error={e.dueOn}>
              <Input id={`as-due-${versionId}`} name="dueOn" type="date" />
            </Field>
            <Field id={`as-stmt-${versionId}`} label="Statement (optional)" error={e.statement}>
              <Input id={`as-stmt-${versionId}`} name="statement" placeholder="I have read and understand this document." />
            </Field>
          </div>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="requireTypedName" /> Require a typed name</label>
        </>
      )}
    </ActionForm>
  );
}
