'use client';
import { useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { addBank, addLeaveType, adjustBalance, approvePolicy, previewPolicy, savePolicy, setBankArchived, setTypeArchived } from './actions';

type Opt = { id: string; label: string };

export function AddBankForm() {
  return (
    <ActionForm action={addBank} label="Add leave bank" submitLabel="Add bank" resetOnSuccess>
      {(e) => (
        <Field id="bank-label" label="Label" hint="A balance members draw from, such as Vacation or Sick leave." error={e.label}>
          <Input id="bank-label" name="label" required />
        </Field>
      )}
    </ActionForm>
  );
}

export function ArchiveBankForm({ id, label, archived }: { id: string; label: string; archived: boolean }) {
  return (
    <ActionForm action={setBankArchived.bind(null, id, !archived)} label={`${archived ? 'Restore' : 'Archive'} ${label}`}
      submitLabel={`${archived ? 'Restore' : 'Archive'} ${label}`} submitVariant="secondary" className="mt-2 space-y-2" />
  );
}

export function AddLeaveTypeForm({ banks }: { banks: Opt[] }) {
  return (
    <ActionForm action={addLeaveType} label="Add leave type" submitLabel="Add leave type" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="lt-label" label="Label" error={e.label}><Input id="lt-label" name="label" required /></Field>
          <Field id="lt-bank" label="Draws from" hint="Leave types without a balance (FMLA, bereavement) are only logged." error={e.bankId}>
            <Select id="lt-bank" name="bankId" defaultValue="">
              <option value="">— No balance —</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </Select>
          </Field>
          <Field id="lt-lead" label="Days of notice" hint="0 allows same-day and retroactive requests." error={e.leadTimeDays}>
            <Input id="lt-lead" name="leadTimeDays" type="number" min={0} max={365} defaultValue={0} />
          </Field>
          <div className="space-y-2 self-end">
            <label className="flex items-center gap-2"><input type="checkbox" name="requiresDocumentation" /> Documentation required</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="countsAsWorked" /> Counts as time worked</label>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function ArchiveTypeForm({ id, label, archived }: { id: string; label: string; archived: boolean }) {
  return (
    <ActionForm action={setTypeArchived.bind(null, id, !archived)} label={`${archived ? 'Restore' : 'Archive'} ${label}`}
      submitLabel={`${archived ? 'Restore' : 'Archive'} ${label}`} submitVariant="secondary" className="mt-2 space-y-2" />
  );
}

/** The policy text is shared by the editor and the preview so admins can test before saving. */
export function PolicyPanel({
  bankKey, bankLabel, initialJson, draftVersion, canApprove,
}: { bankKey: string; bankLabel: string; initialJson: string; draftVersion: number | null; canApprove: boolean }) {
  const [text, setText] = useState(initialJson);
  return (
    <div className="space-y-6">
      <ActionForm action={savePolicy.bind(null, bankKey)} label={`Edit ${bankLabel} policy`} submitLabel="Save draft">
        <Field id={`policy-${bankKey}`} label="Policy (JSON)" hint="Tiers by years of service, caps and carryover. A guided editor is planned; for now edit the values below.">
          <textarea
            id={`policy-${bankKey}`}
            name="policy"
            rows={16}
            spellCheck={false}
            value={text}
            onChange={(ev) => setText(ev.target.value)}
            className="block w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm"
          />
        </Field>
      </ActionForm>

      <ActionForm action={previewPolicy} label={`Preview ${bankLabel} policy`} submitLabel="Preview" submitVariant="secondary">
        {(e) => (
          <>
            <input type="hidden" name="policy" value={text} />
            <p className="text-sm text-muted">Try the policy above on a sample member. Nothing is saved.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id={`pv-hire-${bankKey}`} label="Hire date" error={e.hireDate}><Input id={`pv-hire-${bankKey}`} name="hireDate" type="date" /></Field>
              <Field id={`pv-type-${bankKey}`} label="Employment type" error={e.employmentType}><Input id={`pv-type-${bankKey}`} name="employmentType" defaultValue="career_full_time" /></Field>
              <Field id={`pv-start-${bankKey}`} label="Month to preview" hint="Any date in the accrual period." error={e.periodStart}><Input id={`pv-start-${bankKey}`} name="periodStart" type="date" required /></Field>
              <Field id={`pv-worked-${bankKey}`} label="Hours worked in the period" error={e.hoursWorked}><Input id={`pv-worked-${bankKey}`} name="hoursWorked" type="number" min={0} defaultValue={0} /></Field>
              <Field id={`pv-bal-${bankKey}`} label="Balance before the period" error={e.balance}><Input id={`pv-bal-${bankKey}`} name="balance" type="number" step="0.01" defaultValue={0} /></Field>
            </div>
          </>
        )}
      </ActionForm>

      {draftVersion !== null && canApprove && (
        <ActionForm action={approvePolicy.bind(null, bankKey, draftVersion)} label={`Approve ${bankLabel} policy v${draftVersion}`} submitLabel="Approve policy">
          {(e) => (
            <Field id={`ap-${bankKey}`} label="Takes effect on" hint="Accruals are posted for every completed period from this date, up to two years back." error={e.effectiveFrom}>
              <Input id={`ap-${bankKey}`} name="effectiveFrom" type="date" required />
            </Field>
          )}
        </ActionForm>
      )}
      {draftVersion !== null && !canApprove && <p className="text-sm text-muted">Approving a policy needs configuration approval permission.</p>}
    </div>
  );
}

export function AdjustForm({ members, banks }: { members: Opt[]; banks: Opt[] }) {
  return (
    <ActionForm action={adjustBalance} label="Adjust a balance" submitLabel="Adjust balance" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="adj-member" label="Member" error={e.memberId}>
            <Select id="adj-member" name="memberId" required>{members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select>
          </Field>
          <Field id="adj-bank" label="Bank" error={e.bankId}>
            <Select id="adj-bank" name="bankId" required>{banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</Select>
          </Field>
          <Field id="adj-hours" label="Hours" hint="Positive adds, negative removes." error={e.hours}>
            <Input id="adj-hours" name="hours" type="number" step="0.01" required />
          </Field>
          <Field id="adj-note" label="Note" hint="Why the balance is changing (at least 5 characters)." error={e.note}>
            <Input id="adj-note" name="note" required />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}
