'use client';
import { useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { saveCredentialType, setCredentialTypeStatus } from './actions';

export type Validity =
  | { kind: 'none' }
  | { kind: 'months'; months: number }
  | { kind: 'fixed_cycle'; month: number; day: number; years: number };

export type CredentialTypeValues = { id: string; key: string; label: string; validity: Validity; warnDays: number[]; status: string };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function CredentialTypeForm({ type }: { type?: CredentialTypeValues }) {
  const p = type ? `ct-${type.id}` : 'ct-new';
  const [kind, setKind] = useState<Validity['kind']>(type?.validity.kind ?? 'months');
  const v = type?.validity;
  return (
    <ActionForm
      action={saveCredentialType.bind(null, type?.id ?? null)}
      label={type ? `Edit ${type.label}` : 'Add credential type'}
      submitLabel={type ? 'Save' : 'Add credential type'}
      resetOnSuccess={!type}
    >
      {(e) => (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`${p}-label`} label="Label" error={e.label}><Input id={`${p}-label`} name="label" defaultValue={type?.label} required /></Field>
            <Field id={`${p}-key`} label="Key" error={e.key} hint="lowercase, e.g. hazmat"><Input id={`${p}-key`} name="key" defaultValue={type?.key} required /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field id={`${p}-kind`} label="Validity" error={e['validity.kind'] ?? e.validity}>
              <Select id={`${p}-kind`} name="kind" value={kind} onChange={(ev) => setKind(ev.target.value as Validity['kind'])}>
                <option value="none">Does not expire</option>
                <option value="months">Months after issue</option>
                <option value="fixed_cycle">Fixed cycle end</option>
              </Select>
            </Field>
            {kind === 'months' && (
              <Field id={`${p}-months`} label="Months" error={e['validity.months']}>
                <Input id={`${p}-months`} name="months" type="number" min={1} max={240} defaultValue={v?.kind === 'months' ? v.months : 24} required />
              </Field>
            )}
            {kind === 'fixed_cycle' && (
              <>
                <Field id={`${p}-month`} label="Cycle ends (month)" error={e['validity.month']}>
                  <Select id={`${p}-month`} name="month" defaultValue={v?.kind === 'fixed_cycle' ? v.month : 3}>
                    {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </Select>
                </Field>
                <Field id={`${p}-day`} label="Cycle ends (day)" error={e['validity.day']}>
                  <Input id={`${p}-day`} name="day" type="number" min={1} max={31} defaultValue={v?.kind === 'fixed_cycle' ? v.day : 31} required />
                </Field>
                <Field id={`${p}-years`} label="Cycle length (years)" error={e['validity.years']}>
                  <Input id={`${p}-years`} name="years" type="number" min={1} max={10} defaultValue={v?.kind === 'fixed_cycle' ? v.years : 2} required />
                </Field>
              </>
            )}
          </div>
          <Field id={`${p}-warn`} label="Warning days" error={e.warnDays ?? Object.entries(e).find(([k]) => k.startsWith('warnDays.'))?.[1]}
            hint="Days before expiry to warn, separated by commas">
            <Input id={`${p}-warn`} name="warnDays" defaultValue={(type?.warnDays ?? [90, 60, 30, 7]).join(', ')} />
          </Field>
          {type && <p className="text-sm text-muted">Changing validity applies to credentials recorded from now on; existing expiry dates are not recalculated.</p>}
        </div>
      )}
    </ActionForm>
  );
}

export function CredentialTypeStatusForm({ type }: { type: CredentialTypeValues }) {
  const archive = type.status === 'active';
  return (
    <ActionForm
      action={setCredentialTypeStatus.bind(null, type.id, archive ? 'archived' : 'active')}
      label={`${archive ? 'Archive' : 'Restore'} ${type.label}`}
      submitLabel={archive ? 'Archive' : 'Restore'}
      submitVariant={archive ? 'danger' : 'secondary'}
      className="space-y-2"
    />
  );
}
