'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { approveStaffingRules, saveStaffingRules } from './actions';

export type StaffingFormValues = {
  groupKey: string;
  groupLabel: string;
  credentialKeys: string[];
  departmentMin: number | null;
  unitTypeKey: string | null;
  unitMin: number | null;
};

export function StaffingRulesForm({ initial, credentialTypes, unitTypes }: {
  initial: StaffingFormValues;
  credentialTypes: { key: string; label: string }[];
  unitTypes: { key: string; label: string }[];
}) {
  return (
    <ActionForm action={saveStaffingRules} label="Staffing rules draft" submitLabel="Save draft">
      {(e) => (
        <div className="space-y-4">
          <input type="hidden" name="groupKey" value={initial.groupKey} />
          <Field id="sr-label" label="Group name" hint="What the department calls these providers, e.g. ALS." error={e.groupLabel || undefined}>
            <Input id="sr-label" name="groupLabel" defaultValue={initial.groupLabel} required maxLength={40} />
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Credentials that count for this group</legend>
            <div className="flex flex-wrap gap-2">
              {credentialTypes.map((c) => (
                <label key={c.key} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-3">
                  <input type="checkbox" name="credentialKeys" value={c.key} defaultChecked={initial.credentialKeys.includes(c.key)} />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
            {e.credentialKeys && <p className="text-sm text-danger">{e.credentialKeys}</p>}
          </fieldset>
          <Field id="sr-dept" label="Department minimum on duty" hint="Blank: no department minimum." error={e.departmentMin || undefined}>
            <Input id="sr-dept" name="departmentMin" type="number" min={0} step={1} defaultValue={initial.departmentMin ?? ''} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="sr-unit-type" label="Per-unit rule applies to">
              <Select id="sr-unit-type" name="unitTypeKey" defaultValue={initial.unitTypeKey ?? ''}>
                <option value="">No per-unit rule</option>
                {unitTypes.map((u) => <option key={u.key} value={u.key}>Every {u.label.toLowerCase()}</option>)}
              </Select>
            </Field>
            <Field id="sr-unit-min" label="Minimum per unit" error={e.unitMin || undefined}>
              <Input id="sr-unit-min" name="unitMin" type="number" min={1} step={1} defaultValue={initial.unitMin ?? ''} />
            </Field>
          </div>
          <Field id="sr-reason" label="Change note (optional)" hint="Recorded in the audit log.">
            <Input id="sr-reason" name="reason" />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function ApproveStaffingForm({ version, defaultDate }: { version: number; defaultDate: string }) {
  return (
    <ActionForm action={approveStaffingRules.bind(null, version)} label={`Approve staffing rules v${version}`} submitLabel={`Approve v${version}`}>
      {(e) => (
        <Field id="sr-from" label="Takes effect on" error={e.effectiveFrom}>
          <Input id="sr-from" name="effectiveFrom" type="date" defaultValue={defaultDate} required />
        </Field>
      )}
    </ActionForm>
  );
}
