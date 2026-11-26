'use client';
import type { FormField } from '@soma/validators';
import { ActionForm } from '@/components/action-form';
import { FormFields, valuesFromAnswers } from '@/components/form-fields';
import { SignaturePad } from '@/components/signature-pad';
import { Field, Input } from '@/components/ui/field';
import { decide, submitForm, voidSubmission } from './actions';

export function FillForm({ definitionId, label, fields, requiresSignature, statement, correctsId, answers }: {
  definitionId: string;
  label: string;
  fields: FormField[];
  requiresSignature: boolean;
  statement: string | null;
  correctsId?: string;
  answers?: Record<string, unknown>;
}) {
  return (
    <ActionForm action={submitForm} label={`Fill in ${label}`} submitLabel={correctsId ? 'Submit correction' : 'Submit'} resetOnSuccess={!correctsId} className="space-y-5">
      <input type="hidden" name="definitionId" value={definitionId} />
      {correctsId && <input type="hidden" name="correctsId" value={correctsId} />}
      <FormFields fields={fields} defaults={valuesFromAnswers(fields, answers)} />
      {requiresSignature && statement && <SignaturePad statement={statement} />}
    </ActionForm>
  );
}

export function DecideForms({ submissionId, label }: { submissionId: string; label: string }) {
  return (
    <div className="space-y-3">
      <ActionForm action={decide.bind(null, submissionId, 'approved')} label={`Approve ${label}`} submitLabel="Approve" />
      <ActionForm action={decide.bind(null, submissionId, 'returned')} label={`Return ${label}`} submitLabel="Return for correction" submitVariant="secondary">
        {(e) => <Field id={`ret-${submissionId}`} label="What needs to be fixed?" error={e.note}><Input id={`ret-${submissionId}`} name="note" /></Field>}
      </ActionForm>
      <ActionForm action={decide.bind(null, submissionId, 'rejected')} label={`Reject ${label}`} submitLabel="Reject" submitVariant="danger">
        {(e) => <Field id={`rej-${submissionId}`} label="Why is it rejected?" error={e.note}><Input id={`rej-${submissionId}`} name="note" /></Field>}
      </ActionForm>
    </div>
  );
}

export function VoidForm({ submissionId, label }: { submissionId: string; label: string }) {
  return (
    <ActionForm action={voidSubmission.bind(null, submissionId)} label={`Void ${label}`} submitLabel="Void this submission" submitVariant="secondary">
      {(e) => <Field id={`void-${submissionId}`} label="Why is it void?" error={e.reason}><Input id={`void-${submissionId}`} name="reason" required /></Field>}
    </ActionForm>
  );
}
