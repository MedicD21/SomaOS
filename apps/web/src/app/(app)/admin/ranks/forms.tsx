'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input } from '@/components/ui/field';
import { saveRank, saveShift } from './actions';

export function RankForm({ rank }: { rank?: { id: string; key: string; label: string; sort: number } }) {
  const p = rank ? `rank-${rank.id}` : 'rank-new';
  return (
    <ActionForm action={saveRank.bind(null, rank?.id ?? null)} label={rank ? `Edit ${rank.label}` : 'Add rank'} submitLabel={rank ? 'Save' : 'Add rank'} resetOnSuccess={!rank}>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id={`${p}-label`} label="Label" error={e.label}><Input id={`${p}-label`} name="label" defaultValue={rank?.label} required /></Field>
          <Field id={`${p}-key`} label="Key" error={e.key} hint="lowercase, e.g. captain"><Input id={`${p}-key`} name="key" defaultValue={rank?.key} required /></Field>
          <Field id={`${p}-sort`} label="Order" error={e.sort} hint="1 = most senior"><Input id={`${p}-sort`} name="sort" type="number" min={1} defaultValue={rank?.sort} required /></Field>
        </div>
      )}
    </ActionForm>
  );
}

export function ShiftForm({ shift, singular }: { shift?: { id: string; key: string; label: string; color: string | null }; singular: string }) {
  const p = shift ? `shift-${shift.id}` : 'shift-new';
  return (
    <ActionForm action={saveShift.bind(null, shift?.id ?? null)} label={shift ? `Edit ${shift.label}` : `Add ${singular.toLowerCase()}`} submitLabel={shift ? 'Save' : `Add ${singular.toLowerCase()}`} resetOnSuccess={!shift}>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id={`${p}-label`} label="Label" error={e.label}><Input id={`${p}-label`} name="label" defaultValue={shift?.label} required /></Field>
          <Field id={`${p}-key`} label="Key" error={e.key}><Input id={`${p}-key`} name="key" defaultValue={shift?.key} required /></Field>
          <Field id={`${p}-color`} label="Color" error={e.color}><Input id={`${p}-color`} name="color" type="color" defaultValue={shift?.color ?? '#475569'} /></Field>
        </div>
      )}
    </ActionForm>
  );
}
