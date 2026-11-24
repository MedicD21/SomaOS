'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input } from '@/components/ui/field';
import { decideLeave } from './actions';

export function ApproveForm({ id, label }: { id: string; label: string }) {
  return <ActionForm action={decideLeave.bind(null, id, true)} label={`Approve ${label}`} submitLabel={`Approve ${label}`} className="space-y-2" />;
}

export function DenyForm({ id, label }: { id: string; label: string }) {
  return (
    <ActionForm action={decideLeave.bind(null, id, false)} label={`Deny ${label}`} submitLabel={`Deny ${label}`} submitVariant="danger" className="space-y-2">
      {(e) => (
        <Field id={`deny-${id}`} label="Reason for denying" hint="Required, at least 5 characters. The member sees this." error={e.note}>
          <Input id={`deny-${id}`} name="note" />
        </Field>
      )}
    </ActionForm>
  );
}
