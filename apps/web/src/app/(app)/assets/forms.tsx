'use client';
import { ActionForm } from '@/components/action-form';
import { CustomFieldInputs, type CustomFieldView } from '@/components/custom-field-inputs';
import { Field, Input, Select } from '@/components/ui/field';
import { addAssetType, archiveAsset, createAsset, logAssetEvent, setAssetTypeArchived } from './actions';

type Opt = { id: string; label: string };
const STATUSES = [['in_service', 'In service'], ['out_of_service', 'Out of service'], ['reserve', 'Reserve'], ['maintenance', 'Maintenance'], ['retired', 'Retired']] as const;
const CATEGORIES = [['apparatus', 'Apparatus'], ['equipment', 'Equipment'], ['medical_device', 'Medical device'], ['ppe', 'PPE'], ['other', 'Other']] as const;

export function AddAssetForm({ types, units, defs }: { types: Opt[]; units: Opt[]; defs: CustomFieldView[] }) {
  return (
    <ActionForm action={createAsset} label="Add asset" submitLabel="Add asset" resetOnSuccess>
      {(e) => (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="as-type" label="Type" error={e.typeId}><Select id="as-type" name="typeId" required>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></Field>
            <Field id="as-name" label="Name" error={e.name}><Input id="as-name" name="name" required /></Field>
            <Field id="as-ident" label="Tag or unit number (optional)" error={e.identifier}><Input id="as-ident" name="identifier" /></Field>
            <Field id="as-unit" label="Station" error={e.orgUnitId}>
              <Select id="as-unit" name="orgUnitId" defaultValue=""><option value="">— None —</option>{units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select>
            </Field>
          </div>
          <CustomFieldInputs defs={defs} errors={e} idPrefix="asset" />
        </div>
      )}
    </ActionForm>
  );
}

export function NoteForm({ assetId }: { assetId: string }) {
  return (
    <ActionForm action={logAssetEvent.bind(null, assetId, 'note')} label="Add a note" submitLabel="Add note" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ev-kind" label="Type" error={e.kind}>
            <Select id="ev-kind" name="kind" defaultValue="note"><option value="note">Note</option><option value="maintenance">Maintenance</option></Select>
          </Field>
          <Field id="ev-note" label="Note" error={e.note}><Input id="ev-note" name="note" required /></Field>
        </div>
      )}
    </ActionForm>
  );
}

export function StatusForm({ assetId, current }: { assetId: string; current: string }) {
  return (
    <ActionForm action={logAssetEvent.bind(null, assetId, 'status_change')} label="Change status" submitLabel="Change status">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="st-status" label="New status" error={e.toStatus}>
            <Select id="st-status" name="toStatus" defaultValue="">
              <option value="">Choose…</option>
              {STATUSES.filter(([v]) => v !== current).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field id="st-note" label="Reason" hint="Required for out of service and retired." error={e.note}><Input id="st-note" name="note" /></Field>
        </div>
      )}
    </ActionForm>
  );
}

export function MoveForm({ assetId, units }: { assetId: string; units: Opt[] }) {
  return (
    <ActionForm action={logAssetEvent.bind(null, assetId, 'assignment')} label="Move asset" submitLabel="Move asset">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="mv-unit" label="New station" error={e.toOrgUnitId}>
            <Select id="mv-unit" name="toOrgUnitId" defaultValue=""><option value="">Choose…</option>{units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select>
          </Field>
          <Field id="mv-note" label="Note (optional)" error={e.note}><Input id="mv-note" name="note" /></Field>
        </div>
      )}
    </ActionForm>
  );
}

export function ArchiveAssetForm({ assetId }: { assetId: string }) {
  return (
    <ActionForm action={archiveAsset.bind(null, assetId)} label="Archive asset" submitLabel="Archive asset" submitVariant="secondary">
      {(e) => <Field id="ar-reason" label="Reason" error={e.reason}><Input id="ar-reason" name="reason" required /></Field>}
    </ActionForm>
  );
}

export function AddAssetTypeForm() {
  return (
    <ActionForm action={addAssetType} label="Add asset type" submitLabel="Add asset type" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="at-label" label="Label" error={e.label}><Input id="at-label" name="label" required /></Field>
          <Field id="at-cat" label="Category" error={e.category}>
            <Select id="at-cat" name="category" defaultValue="equipment">{CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function ArchiveTypeForm({ id, label, archived }: { id: string; label: string; archived: boolean }) {
  return (
    <ActionForm action={setAssetTypeArchived.bind(null, id, !archived)} label={`${archived ? 'Restore' : 'Archive'} ${label}`}
      submitLabel={archived ? 'Restore' : 'Archive'} submitVariant="secondary" className="" />
  );
}
