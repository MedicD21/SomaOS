'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { addGroup, addPayCode, assignGroup, setPayCodeArchived, setRate } from './actions';

type Opt = { id: string; label: string };
const KINDS = [['regular', 'Regular'], ['overtime', 'Overtime'], ['premium', 'Premium'], ['leave', 'Leave'], ['other', 'Other']] as const;

export function AddPayCodeForm() {
  return (
    <ActionForm action={addPayCode} label="Add pay code" submitLabel="Add pay code" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="pc-label" label="Label" error={e.label}><Input id="pc-label" name="label" required /></Field>
          <Field id="pc-kind" label="Kind" error={e.kind}>
            <Select id="pc-kind" name="kind" defaultValue="regular">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          </Field>
          <Field id="pc-mult" label="Multiplier" hint="1 = straight time, 1.5 = time and a half, 0 = unpaid." error={e.multiplier}>
            <Input id="pc-mult" name="multiplier" type="number" step="0.001" min={0} max={5} defaultValue={1} required />
          </Field>
          <Field id="pc-export" label="Export code" hint="What your payroll system calls it (optional)." error={e.exportCode}>
            <Input id="pc-export" name="exportCode" />
          </Field>
          <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" name="countsTowardFlsa" defaultChecked /> Counts toward the work-period threshold</label>
        </div>
      )}
    </ActionForm>
  );
}

export function ArchivePayCodeForm({ id, label, archived }: { id: string; label: string; archived: boolean }) {
  return (
    <ActionForm action={setPayCodeArchived.bind(null, id, !archived)} label={`${archived ? 'Restore' : 'Archive'} ${label}`}
      submitLabel={`${archived ? 'Restore' : 'Archive'} ${label}`} submitVariant="secondary" className="mt-2 space-y-2" />
  );
}

export function AddGroupForm() {
  return (
    <ActionForm action={addGroup} label="Add employee group" submitLabel="Add group" resetOnSuccess>
      {(e) => (
        <Field id="grp-label" label="Label" hint="Members in a group share one set of pay rules, e.g. line personnel or part time." error={e.label}>
          <Input id="grp-label" name="label" required />
        </Field>
      )}
    </ActionForm>
  );
}

export function AssignGroupForm({ members, groups }: { members: Opt[]; groups: Opt[] }) {
  return (
    <ActionForm action={assignGroup} label="Assign employee group" submitLabel="Assign group">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="asg-member" label="Member" error={e.memberId}>
            <Select id="asg-member" name="memberId" required>{members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select>
          </Field>
          <Field id="asg-group" label="Group" hint="Members with no group use the group named “default”." error={e.groupId}>
            <Select id="asg-group" name="groupId" defaultValue="">
              <option value="">— Default group —</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </Select>
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function SetRateForm({ members }: { members: Opt[] }) {
  return (
    <ActionForm action={setRate} label="Set hourly rate" submitLabel="Save rate">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="rate-member" label="Member" error={e.memberId}>
            <Select id="rate-member" name="memberId" required>{members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select>
          </Field>
          <Field id="rate-amount" label="Hourly rate" hint="Dollars per hour, up to 4 decimals." error={e.hourlyRate}>
            <Input id="rate-amount" name="hourlyRate" type="number" step="0.0001" min={0} required />
          </Field>
          <Field id="rate-from" label="Effective from" hint="The rate in force before this date ends the day before." error={e.effectiveFrom}>
            <Input id="rate-from" name="effectiveFrom" type="date" required />
          </Field>
          <Field id="rate-note" label="Note (optional)" error={e.note}><Input id="rate-note" name="note" /></Field>
        </div>
      )}
    </ActionForm>
  );
}
