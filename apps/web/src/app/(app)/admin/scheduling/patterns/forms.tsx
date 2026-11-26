'use client';
import { useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { savePattern } from './actions';

export type PatternValues = {
  cycle: ('on' | 'off')[];
  shiftStart: string;
  shiftHours: number;
  anchorDate: string;
  platoons: Record<string, number>;
  kelly?: { everyNthShift: number };
};

export function PatternForm({ initial, shifts, platoonLabel }: {
  initial: PatternValues;
  shifts: { key: string; label: string }[];
  platoonLabel: string;
}) {
  const [cycle, setCycle] = useState<boolean[]>(initial.cycle.map((c) => c === 'on'));
  const toggle = (i: number) => setCycle((c) => c.map((v, n) => (n === i ? !v : v)));
  return (
    <ActionForm action={savePattern} label="Pattern draft" submitLabel="Save draft">
      {(e) => (
        <div className="space-y-4">
          <input type="hidden" name="cycle" value={cycle.map((on) => (on ? 'on' : 'off')).join(',')} />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Cycle ({cycle.length} days)</legend>
            <div className="flex flex-wrap gap-2">
              {cycle.map((on, i) => (
                <label key={i} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-3">
                  <input type="checkbox" checked={on} onChange={() => toggle(i)} />
                  <span>Day {i + 1}<span className="sr-only"> on duty</span></span>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => setCycle((c) => [...c, false])} disabled={cycle.length >= 56}>Add day</Button>
              <Button type="button" variant="secondary" onClick={() => setCycle((c) => c.slice(0, -1))} disabled={cycle.length <= 1}>Remove last day</Button>
            </div>
            {e.cycle && <p className="text-sm text-danger">{e.cycle}</p>}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="pat-start" label="Start time" error={e.shiftStart} hint="Local wall-clock time">
              <Input id="pat-start" name="shiftStart" type="time" defaultValue={initial.shiftStart} required />
            </Field>
            <Field id="pat-hours" label="Hours" error={e.shiftHours}>
              <Input id="pat-hours" name="shiftHours" type="number" min={1} max={48} defaultValue={initial.shiftHours} required />
            </Field>
            <Field id="pat-anchor" label="Anchor date" error={e.anchorDate} hint="Day 1 of the cycle for offset 0">
              <Input id="pat-anchor" name="anchorDate" type="date" defaultValue={initial.anchorDate} required />
            </Field>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{platoonLabel} offsets (days after the anchor date)</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {shifts.map((s) => (
                <Field key={s.key} id={`pat-platoon-${s.key}`} label={s.label} error={e[`platoons.${s.key}`]}>
                  <Input id={`pat-platoon-${s.key}`} name={`platoon.${s.key}`} type="number" min={0} max={55} defaultValue={initial.platoons[s.key]} required />
                </Field>
              ))}
            </div>
          </fieldset>
          <Field id="pat-kelly" label="Kelly day every Nth shift" error={e['kelly.everyNthShift']} hint="Leave blank for no Kelly days">
            <Input id="pat-kelly" name="kellyEvery" type="number" min={2} max={30} defaultValue={initial.kelly?.everyNthShift} />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}
