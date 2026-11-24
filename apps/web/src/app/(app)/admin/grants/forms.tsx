'use client';
import { useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { addGrant, checkAccess, revokeGrant } from './actions';

type Opt = { id: string; label: string };

export function AddGrantForm({ members, roles, units, shifts }: { members: Opt[]; roles: Opt[]; units: Opt[]; shifts: Opt[] }) {
  const [scope, setScope] = useState('department');
  return (
    <ActionForm action={addGrant} label="Add grant" submitLabel="Add grant" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="g-member" label="Member" error={e.memberId}><Select id="g-member" name="memberId" required>{members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select></Field>
          <Field id="g-role" label="Role" error={e.roleId}><Select id="g-role" name="roleId" required>{roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</Select></Field>
          <Field id="g-scope" label="Scope" error={e.scopeKind}>
            <Select id="g-scope" name="scopeKind" value={scope} onChange={(ev) => setScope(ev.target.value)}>
              <option value="department">Whole department</option>
              <option value="org_unit">Org unit and below</option>
              <option value="self">Own records only</option>
            </Select>
          </Field>
          <Field id="g-unit" label="Org unit" hint="Required for org unit scope" error={e.scopeOrgUnitId}>
            <Select id="g-unit" name="scopeOrgUnitId" disabled={scope !== 'org_unit'}><option value="">—</option>{units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select>
          </Field>
          <Field id="g-shift" label="Shift" hint="Optional: limit to one shift" error={e.scopeShiftId}>
            <Select id="g-shift" name="scopeShiftId"><option value="">Any</option>{shifts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
          </Field>
          <Field id="g-from" label="Starts" hint="Blank = now" error={e.validFrom}><Input id="g-from" name="validFrom" type="date" /></Field>
          <Field id="g-to" label="Ends" hint="Blank = no end (e.g. acting assignments end on a date)" error={e.validTo}><Input id="g-to" name="validTo" type="date" /></Field>
          <Field id="g-reason" label="Reason (optional)" error={e.reason}><Input id="g-reason" name="reason" /></Field>
        </div>
      )}
    </ActionForm>
  );
}

export function CheckAccessForm({ members, permissions, units, shifts }: { members: Opt[]; permissions: Opt[]; units: Opt[]; shifts: Opt[] }) {
  return (
    <ActionForm action={checkAccess} label="Check access" submitLabel="Check">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="c-member" label="Member"><Select id="c-member" name="memberId">{members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select></Field>
        <Field id="c-perm" label="Permission"><Select id="c-perm" name="permission">{permissions.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></Field>
        <Field id="c-unit" label="Org unit"><Select id="c-unit" name="orgUnitId"><option value="">Any / none</option>{units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select></Field>
        <Field id="c-shift" label="Shift"><Select id="c-shift" name="shiftId"><option value="">Any / none</option>{shifts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
      </div>
    </ActionForm>
  );
}

export function RevokeForm({ id, label }: { id: string; label: string }) {
  return <ActionForm action={revokeGrant.bind(null, id)} label={label} submitLabel="Revoke" submitVariant="danger" className="" />;
}
