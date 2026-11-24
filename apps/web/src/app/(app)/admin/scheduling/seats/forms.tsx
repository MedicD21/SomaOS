'use client';
import { useRef, useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { saveSeat, setSeatStatus } from './actions';

export type Option = { id: string; label: string };
export type SeatValues = {
  id: string;
  orgUnitId: string;
  label: string;
  sort: number;
  required: boolean;
  minRankId: string | null;
  actingAllowed: boolean;
  status: string;
  groups: string[][];
};

type Group = { key: number; ids: string[] };

export function SeatForm({ seat, units, ranks, types, defaultUnitId }: {
  seat?: SeatValues;
  units: Option[];
  ranks: Option[];
  types: Option[];
  defaultUnitId?: string;
}) {
  const p = seat ? `seat-${seat.id}` : 'seat-new';
  const nextKey = useRef(seat?.groups.length ?? 0);
  const [groups, setGroups] = useState<Group[]>((seat?.groups ?? []).map((ids, key) => ({ key, ids })));
  const toggle = (key: number, id: string) =>
    setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, ids: g.ids.includes(id) ? g.ids.filter((x) => x !== id) : [...g.ids, id] } : g)));
  return (
    <ActionForm
      action={saveSeat.bind(null, seat?.id ?? null)}
      label={seat ? `Edit ${seat.label}` : 'Add seat'}
      submitLabel={seat ? 'Save' : 'Add seat'}
      resetOnSuccess={!seat}
    >
      {(e) => (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id={`${p}-unit`} label="Unit" error={e.orgUnitId}>
              <Select id={`${p}-unit`} name="orgUnitId" defaultValue={seat?.orgUnitId ?? defaultUnitId} required>
                {units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
              </Select>
            </Field>
            <Field id={`${p}-label`} label="Label" error={e.label}><Input id={`${p}-label`} name="label" defaultValue={seat?.label} required /></Field>
            <Field id={`${p}-sort`} label="Order" error={e.sort}><Input id={`${p}-sort`} name="sort" type="number" defaultValue={seat?.sort ?? 0} /></Field>
            <Field id={`${p}-rank`} label="Minimum rank" error={e.minRankId}>
              <Select id={`${p}-rank`} name="minRankId" defaultValue={seat?.minRankId ?? ''}>
                <option value="">None</option>
                {ranks.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="required" defaultChecked={seat?.required ?? true} /> Required
            </label>
            <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="actingAllowed" defaultChecked={seat?.actingAllowed ?? false} /> Acting allowed below minimum rank
            </label>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Credential requirements</p>
            <p className="text-sm text-muted">A member needs one credential from every group (any of within a group, all groups required).</p>
            {groups.map((g, i) => (
              <fieldset key={g.key} className="rounded-md border border-line p-3">
                <legend className="px-1 text-sm font-medium">Requirement group {i + 1}{i > 0 ? ' (and)' : ''}</legend>
                <div className="flex flex-wrap gap-x-4">
                  {types.map((ty) => (
                    <label key={ty.id} className="inline-flex min-h-11 items-center gap-2 text-sm">
                      <input type="checkbox" name={`group.${i + 1}`} value={ty.id} checked={g.ids.includes(ty.id)} onChange={() => toggle(g.key, ty.id)} />
                      {ty.label}
                    </label>
                  ))}
                </div>
                <Button type="button" variant="secondary" onClick={() => setGroups((gs) => gs.filter((x) => x.key !== g.key))}>
                  Remove group {i + 1}
                </Button>
              </fieldset>
            ))}
            <Button type="button" variant="secondary" onClick={() => setGroups((gs) => [...gs, { key: nextKey.current++, ids: [] }])}>
              Add requirement group
            </Button>
            {e.requirementGroups && <p className="text-sm text-danger">{e.requirementGroups}</p>}
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function SeatStatusForm({ seat }: { seat: SeatValues }) {
  const archive = seat.status === 'active';
  return (
    <ActionForm
      action={setSeatStatus.bind(null, seat.id, archive ? 'archived' : 'active')}
      label={`${archive ? 'Archive' : 'Restore'} ${seat.label}`}
      submitLabel={archive ? 'Archive' : 'Restore'}
      submitVariant={archive ? 'danger' : 'secondary'}
      className="space-y-2"
    />
  );
}
