'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input } from '@/components/ui/field';
import { closePeriod, reopenPeriod } from './actions';

export function ClosePeriodForm({ start }: { start: string }) {
  return <ActionForm action={closePeriod.bind(null, start)} label="Close pay period" submitLabel="Close pay period" />;
}

export function ReopenPeriodForm({ id }: { id: string }) {
  return (
    <ActionForm action={reopenPeriod.bind(null, id)} label="Reopen pay period" submitLabel="Reopen pay period" submitVariant="secondary">
      {(e) => (
        <Field id="reopen-reason" label="Why is it being reopened?" error={e.reason}><Input id="reopen-reason" name="reason" required /></Field>
      )}
    </ActionForm>
  );
}
