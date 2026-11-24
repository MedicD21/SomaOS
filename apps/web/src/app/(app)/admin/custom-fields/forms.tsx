'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { addCustomField, archiveCustomField } from './actions';

const TYPES = [
  ['text', 'Text'], ['long_text', 'Long text'], ['number', 'Number'], ['integer', 'Whole number'], ['boolean', 'Yes / no'],
  ['date', 'Date'], ['select', 'Dropdown'], ['multi_select', 'Multiple choice'], ['email', 'Email'], ['phone', 'Phone'],
] as const;

export function AddCustomFieldForm() {
  return (
    <ActionForm action={addCustomField} label="Add custom field" submitLabel="Add field" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="cf-label" label="Label" error={e.label}><Input id="cf-label" name="label" required /></Field>
          <Field id="cf-key" label="Key (optional)" hint="Generated from the label if blank" error={e.key}><Input id="cf-key" name="key" /></Field>
          <Field id="cf-type" label="Type" error={e.type}>
            <Select id="cf-type" name="type" defaultValue="text">{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          </Field>
          <Field id="cf-sens" label="Sensitivity" hint="Sensitive fields are hidden from viewers who cannot edit members" error={e.sensitivity}>
            <Select id="cf-sens" name="sensitivity" defaultValue="">
              <option value="">Normal</option><option value="HR">HR</option><option value="MEDICAL">Medical</option><option value="PHI">PHI</option><option value="CJI">CJI</option>
            </Select>
          </Field>
          <Field id="cf-options" label="Options (for dropdown / multiple choice)" hint="One per line, as value:Label or just Label" error={e.options}>
            <textarea id="cf-options" name="options" rows={3} className="block w-full rounded-md border border-line bg-surface px-3 py-2" />
          </Field>
          <label className="flex items-center gap-2 self-end"><input type="checkbox" name="required" /> Required</label>
        </div>
      )}
    </ActionForm>
  );
}

export function ArchiveFieldForm({ id, label, archived }: { id: string; label: string; archived: boolean }) {
  return (
    <ActionForm action={archiveCustomField.bind(null, id, !archived)} label={`${archived ? 'Restore' : 'Archive'} ${label}`}
      submitLabel={archived ? 'Restore' : 'Archive'} submitVariant="secondary" className="" />
  );
}
