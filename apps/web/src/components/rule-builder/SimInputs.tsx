'use client';
import { useState } from 'react';
import { Field, Input, Select } from '@/components/ui/field';

type Opt = { id: string; label: string };
const WORK: [string, string][] = [
  ['regular', 'Regular'], ['overtime', 'Overtime'], ['trade', 'Trade'], ['holdover', 'Holdover'],
  ['callback', 'Callback'], ['acting', 'Acting'], ['training', 'Training'], ['detail', 'Detail'],
];

export function PaySimInputs({ uid, members, errors }: { uid: string; members: Opt[]; errors: Record<string, string> }) {
  const [mode, setMode] = useState<'period' | 'sample'>('period');
  return (
    <div className="space-y-3">
      <Field id={`${uid}-sim-mode`} label="Simulate with" error={errors.mode}>
        <Select id={`${uid}-sim-mode`} name="mode" value={mode} onChange={(e) => setMode(e.target.value as 'period' | 'sample')}>
          <option value="period">Real shifts and hours in a pay period</option>
          <option value="sample">Made-up sample shifts</option>
        </Select>
      </Field>
      {mode === 'period' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${uid}-sim-date`} label="A date in the pay period" hint="Empty means the current pay period." error={errors.date}>
            <Input id={`${uid}-sim-date`} name="date" type="date" />
          </Field>
          <Field id={`${uid}-sim-member`} label="Member" hint="Empty shows everyone in this group." error={errors.memberId}>
            <Select id={`${uid}-sim-member`} name="memberId" defaultValue="">
              <option value="">Everyone in this group</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </Select>
          </Field>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id={`${uid}-sim-rate`} label="Hourly rate (optional)" hint="Empty shows hours only." error={errors.hourlyRate}>
            <Input id={`${uid}-sim-rate`} name="hourlyRate" type="number" step="0.01" min={0} inputMode="decimal" />
          </Field>
          {[1, 2].map((n) => (
            <fieldset key={n} className="space-y-2 sm:col-span-3 sm:grid sm:grid-cols-3 sm:gap-3 sm:space-y-0">
              <legend className="mb-1 text-sm font-medium sm:col-span-3">Sample shifts {n}</legend>
              <Field id={`${uid}-sim-type${n}`} label="Kind of work" error={errors[`type${n}`]}>
                <Select id={`${uid}-sim-type${n}`} name={`type${n}`} defaultValue={n === 1 ? 'regular' : 'callback'}>
                  {WORK.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
              <Field id={`${uid}-sim-hours${n}`} label="Hours per shift" error={errors[`hours${n}`]}>
                <Input id={`${uid}-sim-hours${n}`} name={`hours${n}`} type="number" step="0.5" min={0.5} max={48} defaultValue={n === 1 ? 24 : 4} />
              </Field>
              <Field id={`${uid}-sim-count${n}`} label="How many shifts" hint="One per day, in order." error={errors[`count${n}`]}>
                <Input id={`${uid}-sim-count${n}`} name={`count${n}`} type="number" step="1" min={0} max={60} defaultValue={n === 1 ? 10 : 0} />
              </Field>
            </fieldset>
          ))}
        </div>
      )}
    </div>
  );
}

export function AccrualSimInputs({ uid, members, errors }: { uid: string; members: Opt[]; errors: Record<string, string> }) {
  const [member, setMember] = useState('');
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${uid}-sim-member`} label="Member" hint="A real member uses their hire date and current balance." error={errors.memberId}>
          <Select id={`${uid}-sim-member`} name="memberId" value={member} onChange={(e) => setMember(e.target.value)}>
            <option value="">A sample member (enter details below)</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </Select>
        </Field>
        <Field id={`${uid}-sim-from`} label="Start from" hint="Any date; empty means today." error={errors.from}>
          <Input id={`${uid}-sim-from`} name="from" type="date" />
        </Field>
      </div>
      {member === '' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id={`${uid}-sim-hire`} label="Hire date" error={errors.hireDate}><Input id={`${uid}-sim-hire`} name="hireDate" type="date" /></Field>
          <Field id={`${uid}-sim-type`} label="Employment type" error={errors.employmentType}><Input id={`${uid}-sim-type`} name="employmentType" defaultValue="career_full_time" /></Field>
          <Field id={`${uid}-sim-balance`} label="Starting balance (hours)" error={errors.balance}><Input id={`${uid}-sim-balance`} name="balance" type="number" step="0.01" defaultValue={0} /></Field>
        </div>
      )}
      <Field id={`${uid}-sim-worked`} label="Hours worked in every period" hint="Only matters for tiers that earn per hours worked." error={errors.hoursWorked}>
        <Input id={`${uid}-sim-worked`} name="hoursWorked" type="number" step="1" min={0} defaultValue={0} />
      </Field>
    </div>
  );
}

export function PatternSimInputs({ uid, shifts, errors }: { uid: string; shifts: { key: string; label: string }[]; errors: Record<string, string> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field id={`${uid}-sim-shift`} label="Shift to compare" error={errors.shiftKey}>
        <Select id={`${uid}-sim-shift`} name="shiftKey" defaultValue={shifts[0]?.key}>
          {shifts.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </Select>
      </Field>
      <Field id={`${uid}-sim-from`} label="Start from" hint="Empty means today." error={errors.from}><Input id={`${uid}-sim-from`} name="from" type="date" /></Field>
      <Field id={`${uid}-sim-weeks`} label="Weeks to show" error={errors.weeks}><Input id={`${uid}-sim-weeks`} name="weeks" type="number" min={1} max={12} defaultValue={8} /></Field>
    </div>
  );
}
