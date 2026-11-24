'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { saveStandingSeat } from '../actions';

export function StandingSeatForm({ memberId, seats, shifts, shiftLabel }: {
  memberId: string;
  seats: { id: string; label: string }[];
  shifts: { id: string; label: string }[];
  shiftLabel: string;
}) {
  return (
    <ActionForm action={saveStandingSeat.bind(null, memberId)} label="Change standing seat" submitLabel="Save standing seat" resetOnSuccess>
      {(e) => (
        <>
          <p className="text-sm text-muted">A new standing seat ends the member&apos;s current one the day it starts.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="ss-seat" label="Seat" error={e.seatId}>
              <Select id="ss-seat" name="seatId" required>{seats.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
            </Field>
            <Field id="ss-platoon" label="Platoon" hint={shiftLabel} error={e.platoonShiftId}>
              <Select id="ss-platoon" name="platoonShiftId" required>{shifts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
            </Field>
            <Field id="ss-kelly" label="Kelly group" hint="Which Nth shift is this member's Kelly day (0 = first); blank for none" error={e.kellyGroup}>
              <Input id="ss-kelly" name="kellyGroup" type="number" min={0} max={29} />
            </Field>
            <Field id="ss-from" label="Effective from" error={e.effectiveFrom}>
              <Input id="ss-from" name="effectiveFrom" type="date" required />
            </Field>
          </div>
        </>
      )}
    </ActionForm>
  );
}
