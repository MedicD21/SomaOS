'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { addBank, addLeaveLimit, addLeaveType, adjustBalance, setBankArchived, setLimitArchived, setTypeArchived, setTypeAudience } from './actions';

type Opt = { id: string; label: string };

export function AddBankForm() {
  return (
    <ActionForm action={addBank} label="Add leave bank" submitLabel="Add bank" resetOnSuccess>
      {(e) => (
        <Field id="bank-label" label="Label" hint="A balance members draw from, such as Vacation or Sick leave." error={e.label}>
          <Input id="bank-label" name="label" required />
        </Field>
      )}
    </ActionForm>
  );
}

export function ArchiveBankForm({ id, label, archived }: { id: string; label: string; archived: boolean }) {
  return (
    <ActionForm action={setBankArchived.bind(null, id, !archived)} label={`${archived ? 'Restore' : 'Archive'} ${label}`}
      submitLabel={`${archived ? 'Restore' : 'Archive'} ${label}`} submitVariant="secondary" className="mt-2 space-y-2" />
  );
}

export function AddLimitForm({ units, shifts, types, today }: { units: Opt[]; shifts: Opt[]; types: Opt[]; today: string }) {
  return (
    <ActionForm action={addLeaveLimit} label="Add leave limit" submitLabel="Add limit" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ll-label" label="Label" error={e.label}><Input id="ll-label" name="label" required /></Field>
          <Field id="ll-max" label="Most members on leave at once" hint="0 means no one may be off." error={e.maxConcurrent}>
            <Input id="ll-max" name="maxConcurrent" type="number" min={0} max={1000} step={1} inputMode="numeric" required />
          </Field>
          <Field id="ll-unit" label="Station" hint="Includes sub-units. Blank means the whole department." error={e.orgUnitId}>
            <Select id="ll-unit" name="orgUnitId" defaultValue=""><option value="">— Whole department —</option>{units.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
          </Field>
          <Field id="ll-shift" label="Shift" error={e.shiftId}>
            <Select id="ll-shift" name="shiftId" defaultValue=""><option value="">— Any shift —</option>{shifts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
          </Field>
          <Field id="ll-type" label="Leave type" hint="Only this type counts toward, and is held to, the limit." error={e.leaveTypeId}>
            <Select id="ll-type" name="leaveTypeId" defaultValue=""><option value="">— Any leave type —</option>{types.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
          </Field>
          <Field id="ll-from" label="Starts" error={e.effectiveFrom}><Input id="ll-from" name="effectiveFrom" type="date" defaultValue={today} required /></Field>
        </div>
      )}
    </ActionForm>
  );
}

export function ArchiveLimitForm({ id, label, archived }: { id: string; label: string; archived: boolean }) {
  return (
    <ActionForm action={setLimitArchived.bind(null, id, !archived)} label={`${archived ? 'Restore' : 'Archive'} ${label}`}
      submitLabel={`${archived ? 'Restore' : 'Archive'} ${label}`} submitVariant="secondary" className="mt-2 space-y-2" />
  );
}

export function AddLeaveTypeForm({ banks }: { banks: Opt[] }) {
  return (
    <ActionForm action={addLeaveType} label="Add leave type" submitLabel="Add leave type" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="lt-label" label="Label" error={e.label}><Input id="lt-label" name="label" required /></Field>
          <Field id="lt-bank" label="Draws from" hint="Leave types without a balance (FMLA, bereavement) are only logged." error={e.bankId}>
            <Select id="lt-bank" name="bankId" defaultValue="">
              <option value="">— No balance —</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </Select>
          </Field>
          <Field id="lt-lead" label="Days of notice" hint="0 allows same-day and retroactive requests." error={e.leadTimeDays}>
            <Input id="lt-lead" name="leadTimeDays" type="number" min={0} max={365} defaultValue={0} />
          </Field>
          <Field id="lt-audience" label="Who can request it" hint={AUDIENCE_HINT} error={e.audience}>
            <AudienceSelect id="lt-audience" defaultValue="member" />
          </Field>
          <div className="space-y-2 self-end">
            <label className="flex items-center gap-2"><input type="checkbox" name="requiresDocumentation" /> Documentation required</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="countsAsWorked" /> Counts as time worked</label>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

const AUDIENCE_HINT = 'Officer-only types (admin, discipline, officer codes) are hidden from crew members.';

function AudienceSelect({ id, defaultValue }: { id: string; defaultValue: 'member' | 'officer' }) {
  return (
    <Select id={id} name="audience" defaultValue={defaultValue}>
      <option value="member">All members</option>
      <option value="officer">Officers and admin only</option>
    </Select>
  );
}

export function TypeAudienceForm({ id, label, audience }: { id: string; label: string; audience: 'member' | 'officer' }) {
  return (
    <ActionForm action={setTypeAudience.bind(null, id)} label={`Who can request ${label}`} submitLabel="Save" submitVariant="secondary" className="mt-2 space-y-2">
      {(e) => (
        <Field id={`aud-${id}`} label={`Who can request ${label}`} hint={AUDIENCE_HINT} error={e.audience}>
          <AudienceSelect id={`aud-${id}`} defaultValue={audience} />
        </Field>
      )}
    </ActionForm>
  );
}

export function ArchiveTypeForm({ id, label, archived }: { id: string; label: string; archived: boolean }) {
  return (
    <ActionForm action={setTypeArchived.bind(null, id, !archived)} label={`${archived ? 'Restore' : 'Archive'} ${label}`}
      submitLabel={`${archived ? 'Restore' : 'Archive'} ${label}`} submitVariant="secondary" className="mt-2 space-y-2" />
  );
}

export function AdjustForm({ members, banks }: { members: Opt[]; banks: Opt[] }) {
  return (
    <ActionForm action={adjustBalance} label="Adjust a balance" submitLabel="Adjust balance" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="adj-member" label="Member" error={e.memberId}>
            <Select id="adj-member" name="memberId" required>{members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select>
          </Field>
          <Field id="adj-bank" label="Bank" error={e.bankId}>
            <Select id="adj-bank" name="bankId" required>{banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</Select>
          </Field>
          <Field id="adj-hours" label="Hours" hint="Positive adds, negative removes." error={e.hours}>
            <Input id="adj-hours" name="hours" type="number" step="0.01" required />
          </Field>
          <Field id="adj-note" label="Note" hint="Why the balance is changing (at least 5 characters)." error={e.note}>
            <Input id="adj-note" name="note" required />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}
