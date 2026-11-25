'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { cancelOpenShift, claimOpenShift, decideClaim, postOpenShift, withdrawClaim } from './actions';

type Opt = { id: string; label: string };

export function PostOpenShiftForm({ seats, today }: { seats: Opt[]; today: string }) {
  return (
    <ActionForm action={postOpenShift} label="Post an open shift" submitLabel="Post open shift" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="os-seat" label="Seat" error={e.seatId}>
            <Select id="os-seat" name="seatId" required>{seats.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
          </Field>
          <Field id="os-type" label="Work type" error={e.type}>
            <Select id="os-type" name="type" defaultValue="overtime"><option value="overtime">Overtime</option><option value="regular">Regular</option></Select>
          </Field>
          <Field id="os-date" label="Date" error={e.date}><Input id="os-date" name="date" type="date" defaultValue={today} required /></Field>
          <Field id="os-start" label="Start time" error={e.startTime}><Input id="os-start" name="startTime" type="time" defaultValue="07:00" required /></Field>
          <Field id="os-hours" label="Hours" error={e.hours}><Input id="os-hours" name="hours" type="number" min={1} max={48} step={1} defaultValue={24} required /></Field>
          <Field id="os-reason" label="Reason" hint="Why is it open, e.g. “Short for the holiday weekend”." error={e.reason}><Input id="os-reason" name="reason" required /></Field>
        </div>
      )}
    </ActionForm>
  );
}

export function ClaimForm({ id, label }: { id: string; label: string }) {
  return (
    <ActionForm action={claimOpenShift.bind(null, id)} label={`Claim ${label}`} submitLabel="Claim this shift" className="space-y-2">
      {(e) => <Field id={`cl-${id}`} label="Note (optional)" error={e.note}><Input id={`cl-${id}`} name="note" maxLength={300} /></Field>}
    </ActionForm>
  );
}

export function WithdrawForm({ id, label }: { id: string; label: string }) {
  return <ActionForm action={withdrawClaim.bind(null, id)} label={`Withdraw claim on ${label}`} submitLabel="Withdraw claim" submitVariant="secondary" className="space-y-2" />;
}

export function ApproveClaimForm({ id, who }: { id: string; who: string }) {
  return (
    <ActionForm action={decideClaim.bind(null, id, true)} label={`Approve ${who}`} submitLabel={`Approve ${who}`} className="space-y-2">
      {(e) => (
        <Field id={`ov-${id}`} label="Override reason" hint="Only needed when a qualification rule blocks this member." error={e.overrideReason}>
          <Input id={`ov-${id}`} name="overrideReason" />
        </Field>
      )}
    </ActionForm>
  );
}

export function DenyClaimForm({ id, who }: { id: string; who: string }) {
  return (
    <ActionForm action={decideClaim.bind(null, id, false)} label={`Deny ${who}`} submitLabel={`Deny ${who}`} submitVariant="secondary" className="space-y-2">
      {(e) => <Field id={`dn-${id}`} label="Note (optional)" error={e.note}><Input id={`dn-${id}`} name="note" /></Field>}
    </ActionForm>
  );
}

export function CancelOpenShiftForm({ id, label }: { id: string; label: string }) {
  return (
    <ActionForm action={cancelOpenShift.bind(null, id)} label={`Cancel ${label}`} submitLabel="Cancel open shift" submitVariant="secondary" className="space-y-2">
      {(e) => <Field id={`cx-${id}`} label="Why is it cancelled?" error={e.reason}><Input id={`cx-${id}`} name="reason" required /></Field>}
    </ActionForm>
  );
}
