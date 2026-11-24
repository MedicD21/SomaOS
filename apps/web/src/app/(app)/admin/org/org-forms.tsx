'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { createOrgUnit, setOrgUnitStatus, updateOrgUnit } from './actions';

export type Option = { id: string; label: string };

function UnitFields({ prefix, errors, types, parents, name = '', typeId = '', parentId = '', code = '' }: {
  prefix: string; errors: Record<string, string>; types: Option[]; parents: Option[];
  name?: string; typeId?: string; parentId?: string; code?: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id={`${prefix}-name`} label="Name" error={errors.name}>
        <Input id={`${prefix}-name`} name="name" defaultValue={name} required />
      </Field>
      <Field id={`${prefix}-type`} label="Type" error={errors.typeId}>
        <Select id={`${prefix}-type`} name="typeId" defaultValue={typeId} required>
          {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </Select>
      </Field>
      <Field id={`${prefix}-parent`} label="Parent" error={errors.parentId}>
        <Select id={`${prefix}-parent`} name="parentId" defaultValue={parentId}>
          <option value="">— None (top level) —</option>
          {parents.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </Select>
      </Field>
      <Field id={`${prefix}-code`} label="Code (optional)" error={errors.code}>
        <Input id={`${prefix}-code`} name="code" defaultValue={code} />
      </Field>
    </div>
  );
}

export function AddUnitForm({ types, parents }: { types: Option[]; parents: Option[] }) {
  return (
    <ActionForm action={createOrgUnit} label="Add org unit" submitLabel="Add unit">
      {(errors) => <UnitFields prefix="new" errors={errors} types={types} parents={parents} />}
    </ActionForm>
  );
}

export function EditUnitForm({ unit, types, parents }: {
  unit: { id: string; name: string; typeId: string; parentId: string | null; code: string | null; status: string };
  types: Option[]; parents: Option[];
}) {
  const archived = unit.status === 'archived';
  return (
    <div className="space-y-3 pt-3">
      <ActionForm action={updateOrgUnit.bind(null, unit.id)} label={`Edit ${unit.name}`} submitLabel="Save">
        {(errors) => (
          <UnitFields prefix={`u-${unit.id}`} errors={errors} types={types} parents={parents}
            name={unit.name} typeId={unit.typeId} parentId={unit.parentId ?? ''} code={unit.code ?? ''} />
        )}
      </ActionForm>
      <ActionForm action={setOrgUnitStatus.bind(null, unit.id, archived ? 'active' : 'archived')}
        label={`${archived ? 'Restore' : 'Archive'} ${unit.name}`} submitLabel={archived ? 'Restore' : 'Archive'} submitVariant="secondary" />
    </div>
  );
}
