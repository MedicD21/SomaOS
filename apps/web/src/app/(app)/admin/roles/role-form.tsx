'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input } from '@/components/ui/field';
import { saveRole } from './actions';

export type PermissionGroup = { module: string; items: { key: string; label: string }[] };

export function RoleForm({ role, groups }: { role?: { id: string; key: string; label: string; permissions: string[] }; groups: PermissionGroup[] }) {
  const p = role ? `role-${role.id}` : 'role-new';
  return (
    <ActionForm action={saveRole.bind(null, role?.id ?? null)} label={role ? `Edit ${role.label}` : 'Add role'} submitLabel={role ? 'Save' : 'Add role'} resetOnSuccess={!role}>
      {(e) => (
        <>
          <Field id={`${p}-label`} label="Label" error={e.label ?? e.key}><Input id={`${p}-label`} name="label" defaultValue={role?.label} required /></Field>
          {role && <input type="hidden" name="key" value={role.key} />}
          {groups.map((g) => (
            <fieldset key={g.module} className="space-y-1">
              <legend className="text-sm font-semibold capitalize">{g.module}</legend>
              {g.items.map((i) => (
                <label key={i.key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="permissions" value={i.key} defaultChecked={role?.permissions.includes(i.key)} /> {i.label}
                </label>
              ))}
            </fieldset>
          ))}
        </>
      )}
    </ActionForm>
  );
}
