'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { addAssignment } from '../actions';

export function AssignmentForm({ memberId, units, shifts, unitLabel, shiftLabel }: {
  memberId: string; units: { id: string; name: string }[]; shifts: { id: string; label: string }[]; unitLabel: string; shiftLabel: string;
}) {
  return (
    <ActionForm action={addAssignment.bind(null, memberId)} label="Add assignment" submitLabel="Add assignment" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="asg-unit" label="Org unit" hint={unitLabel} error={e.orgUnitId}>
            <Select id="asg-unit" name="orgUnitId" required>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
          </Field>
          <Field id="asg-shift" label="Shift" hint={shiftLabel} error={e.shiftId}>
            <Select id="asg-shift" name="shiftId"><option value="">—</option>{shifts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
          </Field>
          <Field id="asg-from" label="Effective from" error={e.effectiveFrom}><Input id="asg-from" name="effectiveFrom" type="date" required /></Field>
        </div>
      )}
    </ActionForm>
  );
}
