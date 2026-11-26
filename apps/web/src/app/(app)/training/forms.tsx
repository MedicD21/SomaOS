'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import {
  addAttendee, cancelSession, completeSession, createSession, markAllPresent, markAttendance, publishSession,
  refreshRequired, scheduleOnRoster, signUp, withdraw,
} from './actions';

type Opt = { id: string; label: string };

export function CreateSessionForm({ courses, units, members, ranks, roles, today }: {
  courses: Opt[]; units: Opt[]; members: Opt[]; ranks: Opt[]; roles: Opt[]; today: string;
}) {
  return (
    <ActionForm action={createSession} label="Schedule a session" submitLabel="Save session" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ts-course" label="Course" error={e.courseId}>
            <Select id="ts-course" name="courseId" required>{courses.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>
          </Field>
          <Field id="ts-title" label="Title" error={e.title}><Input id="ts-title" name="title" required /></Field>
          <Field id="ts-date" label="Date" error={e.date}><Input id="ts-date" name="date" type="date" defaultValue={today} required /></Field>
          <Field id="ts-time" label="Start time" hint="24-hour, in the station's time zone." error={e.startTime}>
            <Input id="ts-time" name="startTime" type="time" defaultValue="09:00" required />
          </Field>
          <Field id="ts-hours" label="Length in hours" error={e.durationHours}>
            <Input id="ts-hours" name="durationHours" type="number" step="0.25" min="0.25" max="48" inputMode="decimal" defaultValue="2" required />
          </Field>
          <Field id="ts-unit" label="Station" hint="Leave on department-wide only if you hold a department-wide grant." error={e.orgUnitId}>
            <Select id="ts-unit" name="orgUnitId" defaultValue=""><option value="">Department-wide</option>{units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select>
          </Field>
          <Field id="ts-location" label="Location" error={e.location}><Input id="ts-location" name="location" /></Field>
          <Field id="ts-instructor" label="Instructor" error={e.instructorId}>
            <Select id="ts-instructor" name="instructorId" defaultValue=""><option value="">None</option>{members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select>
          </Field>
          <Field id="ts-capacity" label="Capacity" hint="Blank means no limit." error={e.capacity}>
            <Input id="ts-capacity" name="capacity" type="number" min={1} inputMode="numeric" />
          </Field>
          <Field id="ts-notes" label="Notes" error={e.notes}><Input id="ts-notes" name="notes" /></Field>
          <Field id="ts-ranks" label="Required: ranks" hint="Everyone with these ranks is enrolled when published." error={e.audience}>
            <select id="ts-ranks" name="audRank" multiple size={4} className="block w-full rounded-md border border-line bg-surface px-3 py-2 text-fg">
              {ranks.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </Field>
          <Field id="ts-roles" label="Required: roles">
            <select id="ts-roles" name="audRole" multiple size={4} className="block w-full rounded-md border border-line bg-surface px-3 py-2 text-fg">
              {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </Field>
          <Field id="ts-units" label="Required: stations">
            <select id="ts-units" name="audUnit" multiple size={4} className="block w-full rounded-md border border-line bg-surface px-3 py-2 text-fg">
              {units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
          </Field>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2"><input type="checkbox" name="assignedOnly" /> By assignment only (no self sign-up)</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="publish" /> Publish now</label>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

const button = (label: string, action: () => Promise<{ ok: boolean | null; message: string | null }>, variant: 'primary' | 'secondary' = 'primary', title = label) => (
  <ActionForm action={action as never} label={title} submitLabel={label} submitVariant={variant} className="space-y-2" />
);

export const SignUpButton = ({ id, title }: { id: string; title: string }) => button('Sign up', signUp.bind(null, id), 'primary', `Sign up for ${title}`);
export const WithdrawButton = ({ id, title }: { id: string; title: string }) => button('Withdraw', withdraw.bind(null, id), 'secondary', `Withdraw from ${title}`);
export const PublishButton = ({ id }: { id: string }) => button('Publish session', publishSession.bind(null, id), 'primary', 'Publish session');
export const RefreshButton = ({ id }: { id: string }) => button('Refresh required list', refreshRequired.bind(null, id), 'secondary', 'Refresh required list');
export const MarkAllButton = ({ id }: { id: string }) => button('Present for all', markAllPresent.bind(null, id), 'secondary', 'Mark everyone present');
export const CompleteButton = ({ id }: { id: string }) => button('Complete and award', completeSession.bind(null, id), 'primary', 'Complete session');
export const RosterButton = ({ id }: { id: string }) => button('Schedule on roster', scheduleOnRoster.bind(null, id), 'secondary', 'Schedule on roster');

export function CancelForm({ id }: { id: string }) {
  return (
    <ActionForm action={cancelSession.bind(null, id)} label="Cancel session" submitLabel="Cancel session" submitVariant="danger" className="space-y-2">
      {(e) => <Field id="cancel-reason" label="Why is it cancelled?" error={e.reason}><Input id="cancel-reason" name="reason" required /></Field>}
    </ActionForm>
  );
}

export function AddAttendeeForm({ id, members }: { id: string; members: Opt[] }) {
  return (
    <ActionForm action={addAttendee.bind(null, id)} label="Add an attendee" submitLabel="Add" submitVariant="secondary" resetOnSuccess>
      {(e) => (
        <Field id="add-member" label="Member" error={e.memberId}>
          <Select id="add-member" name="memberId" required>{members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select>
        </Field>
      )}
    </ActionForm>
  );
}

const STATUSES = [['attended', 'Attended'], ['partial', 'Partial'], ['absent', 'Absent'], ['excused', 'Excused']] as const;

export function AttendanceForm({ enrollmentId, name, status, hours, note }: { enrollmentId: string; name: string; status: string | null; hours: number | null; note: string | null }) {
  const key = enrollmentId.slice(0, 8);
  return (
    <ActionForm action={markAttendance.bind(null, enrollmentId)} label={`Attendance for ${name}`} submitLabel="Save" submitVariant="secondary" className="mt-2 space-y-2">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id={`st-${key}`} label="Status" error={e.status}>
            <Select id={`st-${key}`} name="status" defaultValue={status ?? 'attended'}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          </Field>
          <Field id={`hr-${key}`} label="Hours (partial only)" error={e.hours}>
            <Input id={`hr-${key}`} name="hours" type="number" step="0.25" min="0.25" inputMode="decimal" defaultValue={hours && status === 'partial' ? hours : ''} />
          </Field>
          <Field id={`nt-${key}`} label="Note (partial only)" error={e.note}><Input id={`nt-${key}`} name="note" defaultValue={note ?? ''} /></Field>
        </div>
      )}
    </ActionForm>
  );
}
