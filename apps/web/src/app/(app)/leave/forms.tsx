'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { cancelLeave, requestLeave } from './actions';

export type TypeOption = { id: string; label: string; hint: string };

export function RequestLeaveForm({ types }: { types: TypeOption[] }) {
  return (
    <ActionForm action={requestLeave} label="Request leave" submitLabel="Request leave" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="rl-type" label="Leave type" error={e.leaveTypeId}>
            <Select id="rl-type" name="leaveTypeId" required>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </Select>
          </Field>
          <div />
          <Field id="rl-start" label="First day" error={e.startDate}>
            <Input id="rl-start" name="startDate" type="date" required />
          </Field>
          <Field id="rl-end" label="Last day" hint="Leave covers your scheduled shifts that start on these days." error={e.endDate}>
            <Input id="rl-end" name="endDate" type="date" required />
          </Field>
          <div className="sm:col-span-2">
            <Field id="rl-reason" label="Reason (optional)" error={e.reason}>
              <Input id="rl-reason" name="reason" />
            </Field>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function CancelLeaveForm({ id, label }: { id: string; label: string }) {
  return (
    <ActionForm action={cancelLeave.bind(null, id)} label={`Cancel ${label}`} submitLabel={`Cancel ${label}`} submitVariant="secondary" className="mt-2 space-y-2" />
  );
}
