'use client';
import { ActionForm, type ActionResult } from '@/components/action-form';
import { CustomFieldInputs, type CustomFieldView } from '@/components/custom-field-inputs';
import { Field, Input, Select } from '@/components/ui/field';

const EMPLOYMENT = [
  ['career_full_time', 'Career full-time'], ['career_part_time', 'Career part-time'], ['volunteer', 'Volunteer'],
  ['per_diem', 'Per diem'], ['other', 'Other'],
] as const;

export type MemberValues = {
  firstName: string; lastName: string; preferredName: string | null; employeeNumber: string | null; email: string | null;
  phone: string | null; rankId: string | null; employmentType: string; hireDate: string | null; seniorityDate: string | null;
  status: string; custom: Record<string, unknown>;
};

export function MemberForm({ action, label, submitLabel, ranks, defs, member }: {
  action: (prev: ActionResult, form: FormData) => Promise<ActionResult>;
  label: string; submitLabel: string;
  ranks: { id: string; label: string }[];
  defs: CustomFieldView[];
  member?: MemberValues;
}) {
  const p = member ? 'edit' : 'new';
  return (
    <ActionForm action={action} label={label} submitLabel={submitLabel} resetOnSuccess={!member}>
      {(e) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`${p}-first`} label="First name" error={e.firstName}><Input id={`${p}-first`} name="firstName" defaultValue={member?.firstName} required /></Field>
            <Field id={`${p}-last`} label="Last name" error={e.lastName}><Input id={`${p}-last`} name="lastName" defaultValue={member?.lastName} required /></Field>
            <Field id={`${p}-pref`} label="Preferred name (optional)" error={e.preferredName}><Input id={`${p}-pref`} name="preferredName" defaultValue={member?.preferredName ?? ''} /></Field>
            <Field id={`${p}-emp`} label="Employee number (optional)" error={e.employeeNumber}><Input id={`${p}-emp`} name="employeeNumber" defaultValue={member?.employeeNumber ?? ''} /></Field>
            <Field id={`${p}-email`} label="Email (optional)" error={e.email}><Input id={`${p}-email`} name="email" type="email" defaultValue={member?.email ?? ''} /></Field>
            <Field id={`${p}-phone`} label="Phone (optional)" error={e.phone}><Input id={`${p}-phone`} name="phone" type="tel" defaultValue={member?.phone ?? ''} /></Field>
            <Field id={`${p}-rank`} label="Rank" error={e.rankId}>
              <Select id={`${p}-rank`} name="rankId" defaultValue={member?.rankId ?? ''}>
                <option value="">—</option>
                {ranks.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
            </Field>
            <Field id={`${p}-type`} label="Employment type" error={e.employmentType}>
              <Select id={`${p}-type`} name="employmentType" defaultValue={member?.employmentType ?? 'career_full_time'}>
                {EMPLOYMENT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field id={`${p}-hire`} label="Hire date (optional)" error={e.hireDate}><Input id={`${p}-hire`} name="hireDate" type="date" defaultValue={member?.hireDate ?? ''} /></Field>
            <Field id={`${p}-sen`} label="Seniority date (optional)" error={e.seniorityDate}><Input id={`${p}-sen`} name="seniorityDate" type="date" defaultValue={member?.seniorityDate ?? ''} /></Field>
            {member && (
              <Field id={`${p}-status`} label="Status">
                <Select id={`${p}-status`} name="status" defaultValue={member.status}>
                  <option value="active">Active</option><option value="leave">On leave</option><option value="separated">Separated</option>
                </Select>
              </Field>
            )}
          </div>
          <CustomFieldInputs defs={defs} values={member?.custom} errors={e} idPrefix={p} />
        </>
      )}
    </ActionForm>
  );
}
