'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { completeChecklist, saveChecklist } from './actions';

type Opt = { id: string; label: string };
type Item = { key: string; label: string; kind: 'pass_fail' | 'number' | 'text'; required: boolean };

export function CompleteForm({ templateId, label, items, assets, units }: { templateId: string; label: string; items: Item[]; assets: Opt[] | null; units: Opt[] }) {
  return (
    <ActionForm action={completeChecklist.bind(null, templateId)} label={`Complete ${label}`} submitLabel="Submit check" resetOnSuccess>
      {(e) => (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {assets ? (
              <Field id="ck-asset" label="Unit being checked" error={e.assetId}>
                <Select id="ck-asset" name="assetId" required>{assets.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select>
              </Field>
            ) : (
              <Field id="ck-unit" label="Your station" hint="Choose the station this check is for." error={e.orgUnitId}>
                <Select id="ck-unit" name="orgUnitId" required>{units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select>
              </Field>
            )}
          </div>
          <fieldset className="space-y-3">
            <legend className="mb-1 font-semibold">Items</legend>
            {items.map((i) => {
              const id = `ans-${i.key}`;
              const text = i.required ? i.label : `${i.label} (optional)`;
              return (
                <Field key={i.key} id={id} label={text} error={e[`answer.${i.key}`]}>
                  {i.kind === 'pass_fail' ? (
                    <Select id={id} name={`answer.${i.key}`} defaultValue=""><option value="">Choose…</option><option value="pass">Pass</option><option value="fail">Fail</option></Select>
                  ) : i.kind === 'number' ? (
                    <Input id={id} name={`answer.${i.key}`} type="number" step="any" inputMode="decimal" />
                  ) : (
                    <Input id={id} name={`answer.${i.key}`} maxLength={500} />
                  )}
                </Field>
              );
            })}
          </fieldset>
          <Field id="ck-note" label="Note (optional)" error={e.note}><Input id="ck-note" name="note" maxLength={500} /></Field>
        </div>
      )}
    </ActionForm>
  );
}

export function SaveChecklistForm({ initial, types }: { initial?: { key: string; label: string; assetTypeId: string | null; logFailure: boolean; itemsText: string }; types: Opt[] }) {
  const p = initial?.key ?? 'new';
  return (
    <ActionForm action={saveChecklist} label={initial ? `Edit ${initial.label}` : 'Add checklist'} submitLabel={initial ? 'Save as new version' : 'Add checklist'} resetOnSuccess={!initial}>
      {(e) => (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`cl-label-${p}`} label="Name" error={e.label}><Input id={`cl-label-${p}`} name="label" defaultValue={initial?.label} required /></Field>
            <Field id={`cl-type-${p}`} label="For asset type" hint="Leave blank for a station check." error={e.assetTypeId}>
              <Select id={`cl-type-${p}`} name="assetTypeId" defaultValue={initial?.assetTypeId ?? ''}><option value="">— Station check —</option>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select>
            </Field>
          </div>
          {initial && <input type="hidden" name="key" value={initial.key} />}
          <Field id={`cl-items-${p}`} label="Items" hint="One per line: Label | pass_fail, number or text | optional (leave off for required)." error={e.items}>
            <textarea id={`cl-items-${p}`} name="items" rows={8} defaultValue={initial?.itemsText} required className="block w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm" />
          </Field>
          <label className="flex items-center gap-2"><input type="checkbox" name="logFailure" defaultChecked={initial?.logFailure ?? true} /> Log failed checks on the asset’s history</label>
        </div>
      )}
    </ActionForm>
  );
}
