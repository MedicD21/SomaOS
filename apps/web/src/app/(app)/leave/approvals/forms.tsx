'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input } from '@/components/ui/field';
import { decideLeave } from './actions';

/** `overridable`: the request breaks a leave limit and the caller may waive it (leave.manage) with a reason. */
export function ApproveForm({ id, label, overridable = false }: { id: string; label: string; overridable?: boolean }) {
  return (
    <ActionForm action={decideLeave.bind(null, id, true)} label={`Approve ${label}`} submitLabel={`Approve ${label}`} className="space-y-2">
      {overridable
        ? (e) => (
            <Field id={`ovr-${id}`} label="Limit override reason" hint="This request goes over a leave limit. Explain why you are approving it anyway." error={e.overrideReason}>
              <Input id={`ovr-${id}`} name="overrideReason" />
            </Field>
          )
        : null}
    </ActionForm>
  );
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
