'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { saveSettings } from './actions';

const TERM_LABELS: Record<string, string> = {
  shift: 'Shift', shifts: 'Shifts (plural)', station: 'Station', stations: 'Stations (plural)',
  unit: 'Unit', units: 'Units (plural)', member: 'Member', members: 'Members (plural)',
  battalion: 'Battalion', battalions: 'Battalions (plural)',
};

export function SettingsForm({
  name, timezone, timezones, terminology, enabledModules,
}: { name: string; timezone: string; timezones: string[]; terminology: Record<string, string>; enabledModules: string[] }) {
  return (
    <ActionForm action={saveSettings} label="Department settings" submitLabel="Save settings">
      {(errors) => (
        <>
          <Field id="name" label="Department name" error={errors.name}>
            <Input id="name" name="name" defaultValue={name} required />
          </Field>
          <Field id="timezone" label="Time zone" error={errors.timezone} hint="Used for shift times, pay periods and reports.">
            <Select id="timezone" name="timezone" defaultValue={timezone}>
              {timezones.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </Select>
          </Field>
          <fieldset className="space-y-3">
            <legend className="font-semibold">Terminology</legend>
            <p className="text-sm text-muted">Rename labels to match your department. Leave blank for the default.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(TERM_LABELS).map(([key, label]) => (
                <Field key={key} id={`term-${key}`} label={label} error={errors[`terminology.${key}`]}>
                  <Input id={`term-${key}`} name={`term.${key}`} defaultValue={terminology[key] ?? ''} placeholder={label.replace(' (plural)', '')} />
                </Field>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="font-semibold">Modules</legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked disabled aria-describedby="admin-always" /> Admin
              <span id="admin-always" className="text-sm text-muted">(always on)</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="modules" value="files" defaultChecked={enabledModules.includes('files')} /> Files
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="modules" value="scheduling" defaultChecked={enabledModules.includes('scheduling')} /> Scheduling
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="modules" value="leave" defaultChecked={enabledModules.includes('leave')} /> Leave
            </label>
          </fieldset>
          <Field id="reason" label="Reason for change (optional)">
            <Input id="reason" name="reason" />
          </Field>
        </>
      )}
    </ActionForm>
  );
}
