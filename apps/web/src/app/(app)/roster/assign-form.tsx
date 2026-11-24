'use client';
import { startTransition, useActionState, type FormEvent } from 'react';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { cancelShift, fillSeat, generateSchedule, type AssignState } from './actions';

export type MemberOption = { id: string; name: string; rank: string | null };

const TYPE_LABELS: Record<string, string> = {
  regular: 'Regular',
  overtime: 'Overtime',
  trade: 'Trade',
  holdover: 'Holdover',
  callback: 'Callback',
  acting: 'Acting',
  training: 'Training',
  detail: 'Detail',
};

/** Member picker + type select for one vacant seat. A blocked fill lists why and, for override holders, asks for a reason. */
export function AssignForm({ seatId, date, label, members, canOverride, defaultStart, defaultHours }: {
  seatId: string;
  date: string;
  label: string;
  members: MemberOption[];
  canOverride: boolean;
  defaultStart: string;
  defaultHours: number;
}) {
  const [state, formAction, pending] = useActionState<AssignState, FormData>(fillSeat.bind(null, seatId, date), { ok: null, message: null });
  const id = (f: string) => `fill-${seatId}-${f}`;
  const askReason = canOverride && !!state.overridable;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form onSubmit={onSubmit} aria-label={`Fill ${label}`} className="mt-2 space-y-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={id('member')} label="Member">
          <Select id={id('member')} name="memberId" required defaultValue="">
            <option value="" disabled>Choose a member</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.rank ? `${m.name} (${m.rank})` : m.name}</option>
            ))}
          </Select>
        </Field>
        <Field id={id('type')} label="Type">
          <Select id={id('type')} name="type" defaultValue="overtime">
            {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field id={id('start')} label="Start time"><Input id={id('start')} name="startTime" type="time" defaultValue={defaultStart} required /></Field>
        <Field id={id('hours')} label="Hours"><Input id={id('hours')} name="hours" type="number" min={1} max={48} defaultValue={defaultHours} required /></Field>
        {askReason && (
          <div className="sm:col-span-2">
            <Field id={id('reason')} label="Override reason" hint="Required to fill despite the blocks above (at least 5 characters).">
              <Input id={id('reason')} name="overrideReason" required minLength={5} maxLength={500} aria-describedby={`${id('reason')}-hint`} />
            </Field>
          </div>
        )}
      </div>
      {state.ok === false && state.message && (
        <div role="alert" className="rounded-md border border-danger p-3 text-sm text-danger">
          {state.blocked?.length ? (
            <>
              <p className="font-medium">{state.message}</p>
              <ul className="mt-1 list-disc pl-5">
                {state.blocked.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </>
          ) : (
            state.message
          )}
        </div>
      )}
      {state.ok && state.message && <p role="status" className="text-sm font-medium">{state.message}</p>}
      <Button type="submit" disabled={pending}>Fill seat</Button>
    </form>
  );
}

export function CancelForm({ assignmentId, label }: { assignmentId: string; label: string }) {
  const id = `cancel-${assignmentId}`;
  return (
    <ActionForm action={cancelShift.bind(null, assignmentId)} label={`Cancel ${label}`} submitLabel="Cancel shift" submitVariant="danger" className="mt-2 space-y-3">
      <Field id={id} label="Cancel reason">
        <Input id={id} name="reason" required minLength={5} maxLength={500} />
      </Field>
    </ActionForm>
  );
}

export function GenerateForm({ from, to }: { from: string; to: string }) {
  return (
    <ActionForm action={generateSchedule} label="Generate schedule" submitLabel="Generate">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="gen-from" label="From"><Input id="gen-from" name="from" type="date" defaultValue={from} required /></Field>
        <Field id="gen-to" label="To"><Input id="gen-to" name="to" type="date" defaultValue={to} required /></Field>
      </div>
    </ActionForm>
  );
}
