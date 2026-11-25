'use client';
import { useState } from 'react';
import { keyFromLabel, type FormField, type FormFieldType } from '@soma/validators';
import { ActionForm } from '@/components/action-form';
import { FormFields } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { publishDefinition, retireForm, saveDefinition } from './actions';

const TYPES: [FormFieldType, string][] = [
  ['text', 'Short text'], ['long_text', 'Long text'], ['number', 'Number'], ['integer', 'Whole number'], ['boolean', 'Yes / No'],
  ['date', 'Date'], ['select', 'Choose one'], ['multi_select', 'Choose several'], ['email', 'Email'], ['phone', 'Phone'],
];

type Row = { uid: number; key: string; label: string; type: FormFieldType; required: boolean; options: string; showField: string; showEquals: string };

const toRow = (f: FormField, uid: number): Row => ({
  uid, key: f.key, label: f.label, type: f.type, required: f.required,
  options: (f.options ?? []).map((o) => (o.value === o.label ? o.label : `${o.value}|${o.label}`)).join('\n'),
  showField: f.show_if?.field ?? '', showEquals: f.show_if ? String(f.show_if.equals) : '',
});

function optionsOf(text: string): { value: string; label: string }[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [a, b] = l.includes('|') ? l.split('|', 2) : [keyFromLabel(l) || l, l];
    return { value: (a ?? '').trim(), label: (b ?? a ?? '').trim() };
  });
}

function toField(r: Row, rows: Row[]): FormField {
  const f: FormField = { key: r.key || keyFromLabel(r.label), label: r.label, type: r.type, required: r.required };
  if (r.type === 'select' || r.type === 'multi_select') f.options = optionsOf(r.options);
  if (r.showField) {
    const ctl = rows.find((x) => x.key === r.showField);
    const raw = r.showEquals.trim();
    const equals: string | number | boolean = ctl?.type === 'boolean' ? raw === 'true' : ctl?.type === 'number' || ctl?.type === 'integer' ? Number(raw) : raw;
    f.show_if = { field: r.showField, equals };
  }
  return f;
}

/** Field-list editor with a live preview that uses the same renderer members see. Saving always creates a new draft version. */
export function DefinitionEditor({ initial }: {
  initial: { key: string; label: string; description: string; fields: FormField[]; requiresSignature: boolean; signatureStatement: string; approval: 'none' | 'officer'; isNew: boolean };
}) {
  const [rows, setRows] = useState<Row[]>(initial.fields.map(toRow));
  const [next, setNext] = useState(initial.fields.length + 1);
  const [label, setLabel] = useState(initial.label);
  const [key, setKey] = useState(initial.key);
  const [signed, setSigned] = useState(initial.requiresSignature);
  const fields = rows.map((r) => toField(r, rows));
  const patch = (uid: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...p } : r)));
  const move = (i: number, d: -1 | 1) => setRows((rs) => {
    const j = i + d;
    if (j < 0 || j >= rs.length) return rs;
    const copy = [...rs];
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    return copy;
  });

  return (
    <div className="space-y-6">
      <ActionForm action={saveDefinition} label="Save form definition" submitLabel="Save as new draft version" className="space-y-5">
        {(e) => (
          <>
            <input type="hidden" name="fields" value={JSON.stringify(fields)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="fd-label" label="Form name" error={e.label}>
                <Input id="fd-label" name="label" value={label} onChange={(ev) => { setLabel(ev.target.value); if (initial.isNew) setKey(keyFromLabel(ev.target.value)); }} required />
              </Field>
              <Field id="fd-key" label="Key" hint="Short name used in links. It cannot change after the first save." error={e.key}>
                <Input id="fd-key" name="key" value={key} onChange={(ev) => setKey(ev.target.value)} readOnly={!initial.isNew} required />
              </Field>
              <div className="sm:col-span-2">
                <Field id="fd-desc" label="Description (optional)" error={e.description}><Input id="fd-desc" name="description" defaultValue={initial.description} /></Field>
              </div>
              <Field id="fd-approval" label="Approval" error={e.approval}>
                <Select id="fd-approval" name="approval" defaultValue={initial.approval}>
                  <option value="none">None — filed when submitted</option>
                  <option value="officer">The submitter’s officer approves it</option>
                </Select>
              </Field>
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" name="requiresSignature" checked={signed} onChange={(ev) => setSigned(ev.target.checked)} /> Requires a signature
              </label>
              {signed && (
                <div className="sm:col-span-2">
                  <Field id="fd-stmt" label="Statement the signer agrees to" error={e.signatureStatement}>
                    <Input id="fd-stmt" name="signatureStatement" defaultValue={initial.signatureStatement} />
                  </Field>
                </div>
              )}
            </div>

            <fieldset className="space-y-3">
              <legend className="text-lg font-semibold">Fields</legend>
              <ol aria-label="Fields" className="space-y-3">
                {rows.map((r, i) => {
                  const earlier = rows.slice(0, i).filter((x) => x.key || x.label);
                  return (
                    <li key={r.uid} className="space-y-3 rounded-lg border border-line bg-surface p-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field id={`f-label-${r.uid}`} label={`Field ${i + 1} label`}>
                          <Input id={`f-label-${r.uid}`} value={r.label} onChange={(ev) => patch(r.uid, { label: ev.target.value, key: keyFromLabel(ev.target.value) })} />
                        </Field>
                        <Field id={`f-type-${r.uid}`} label="Type">
                          <Select id={`f-type-${r.uid}`} value={r.type} onChange={(ev) => patch(r.uid, { type: ev.target.value as FormFieldType })}>
                            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </Select>
                        </Field>
                        {(r.type === 'select' || r.type === 'multi_select') && (
                          <div className="sm:col-span-2">
                            <Field id={`f-opts-${r.uid}`} label="Options" hint="One per line.">
                              <textarea id={`f-opts-${r.uid}`} rows={3} value={r.options} onChange={(ev) => patch(r.uid, { options: ev.target.value })}
                                className="block w-full rounded-md border border-line bg-surface px-3 py-2 text-fg" />
                            </Field>
                          </div>
                        )}
                        {earlier.length > 0 && (
                          <>
                            <Field id={`f-show-${r.uid}`} label="Show only when…">
                              <Select id={`f-show-${r.uid}`} value={r.showField} onChange={(ev) => patch(r.uid, { showField: ev.target.value })}>
                                <option value="">Always</option>
                                {earlier.map((x) => <option key={x.uid} value={x.key || keyFromLabel(x.label)}>{x.label || x.key}</option>)}
                              </Select>
                            </Field>
                            {r.showField && (
                              <Field id={`f-eq-${r.uid}`} label="…is equal to" hint="For yes/no fields use true or false.">
                                <Input id={`f-eq-${r.uid}`} value={r.showEquals} onChange={(ev) => patch(r.uid, { showEquals: ev.target.value })} />
                              </Field>
                            )}
                          </>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={r.required} onChange={(ev) => patch(r.uid, { required: ev.target.checked })} /> Required</label>
                        <Button type="button" variant="secondary" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move field ${i + 1} up`}>Up</Button>
                        <Button type="button" variant="secondary" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`Move field ${i + 1} down`}>Down</Button>
                        <Button type="button" variant="danger" onClick={() => setRows((rs) => rs.filter((x) => x.uid !== r.uid))} aria-label={`Remove field ${i + 1}`}>Remove</Button>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <Button type="button" variant="secondary" onClick={() => { setRows((rs) => [...rs, { uid: next, key: '', label: '', type: 'text', required: false, options: '', showField: '', showEquals: '' }]); setNext(next + 1); }}>
                Add a field
              </Button>
            </fieldset>
          </>
        )}
      </ActionForm>

      <section aria-labelledby="preview" className="rounded-lg border border-line bg-surface p-4">
        <h2 id="preview" className="mb-3 text-lg font-semibold">Preview</h2>
        <p className="mb-3 text-sm text-muted">This is how members will see the form. Nothing you type here is saved.</p>
        {fields.some((f) => f.label) ? <FormFields key={fields.map((f) => f.key + f.type).join()} fields={fields.filter((f) => f.label)} idPrefix="pv" /> : <p>Add a field to see it here.</p>}
      </section>
    </div>
  );
}

export function PublishDefinitionForm({ id, label, version }: { id: string; label: string; version: number }) {
  return <ActionForm action={publishDefinition.bind(null, id)} label={`Publish ${label} version ${version}`} submitLabel={`Publish version ${version}`} />;
}

export function RetireForm({ formKey, label }: { formKey: string; label: string }) {
  return <ActionForm action={retireForm.bind(null, formKey)} label={`Retire ${label}`} submitLabel="Retire form" submitVariant="secondary" />;
}
