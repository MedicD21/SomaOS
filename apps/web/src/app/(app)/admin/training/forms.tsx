'use client';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/field';
import { addCategory, addCourse, addRequirement, archiveItem } from './actions';

type Opt = { id: string; label: string };

export function AddCategoryForm() {
  return (
    <ActionForm action={addCategory} label="Add training category" submitLabel="Add category" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="cat-label" label="Label" error={e.label}><Input id="cat-label" name="label" required /></Field>
          <Field id="cat-code" label="External code" hint="Free text, e.g. a reporting code. Optional." error={e.externalCode}><Input id="cat-code" name="externalCode" /></Field>
        </div>
      )}
    </ActionForm>
  );
}

export function AddCourseForm({ categories, credentialTypes }: { categories: Opt[]; credentialTypes: Opt[] }) {
  return (
    <ActionForm action={addCourse} label="Add course" submitLabel="Add course" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="crs-label" label="Label" error={e.label}><Input id="crs-label" name="label" required /></Field>
          <Field id="crs-cat" label="Category" error={e.categoryId}>
            <Select id="crs-cat" name="categoryId" required>{categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>
          </Field>
          <Field id="crs-hours" label="Default hours" error={e.defaultHours}><Input id="crs-hours" name="defaultHours" type="number" step="0.25" min="0.25" defaultValue={2} required /></Field>
          <Field id="crs-cred" label="Credential granted on completion" hint="Optional. Completing a session grants or renews it." error={e.credentialTypeId}>
            <Select id="crs-cred" name="credentialTypeId" defaultValue=""><option value="">None</option>{credentialTypes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>
          </Field>
          <Field id="crs-pct" label="Hours needed to qualify (%)" hint="100 means the whole session." error={e.minHoursPct}><Input id="crs-pct" name="minHoursPct" type="number" min={0} max={100} defaultValue={100} /></Field>
          <Field id="crs-desc" label="Description" error={e.description}><Input id="crs-desc" name="description" /></Field>
        </div>
      )}
    </ActionForm>
  );
}

export function AddRequirementForm({ categories, ranks, roles, today }: { categories: Opt[]; ranks: Opt[]; roles: Opt[]; today: string }) {
  return (
    <ActionForm action={addRequirement} label="Add requirement" submitLabel="Add requirement" resetOnSuccess>
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="rq-label" label="Label" error={e.label}><Input id="rq-label" name="label" required /></Field>
          <Field id="rq-cat" label="Category" error={e.categoryId}>
            <Select id="rq-cat" name="categoryId" required>{categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>
          </Field>
          <Field id="rq-hours" label="Required hours" error={e.requiredHours}><Input id="rq-hours" name="requiredHours" type="number" step="0.25" min="0.25" defaultValue={24} required /></Field>
          <Field id="rq-from" label="Takes effect" hint="An earlier open-ended version ends the day before." error={e.effectiveFrom}><Input id="rq-from" name="effectiveFrom" type="date" defaultValue={today} required /></Field>
          <Field id="rq-rank" label="Rank" hint="Blank applies to everyone." error={e.rankId}>
            <Select id="rq-rank" name="rankId" defaultValue=""><option value="">Everyone</option>{ranks.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>
          </Field>
          <Field id="rq-role" label="Role" hint="Blank applies to every role." error={e.roleId}>
            <Select id="rq-role" name="roleId" defaultValue=""><option value="">Every role</option>{roles.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>
          </Field>
          <Field id="rq-kind" label="Window" error={e.windowKind}>
            <Select id="rq-kind" name="windowKind" defaultValue="calendar_year">
              <option value="calendar_year">Calendar year</option>
              <option value="rolling_months">Rolling months</option>
              <option value="fixed_cycle">Fixed cycle</option>
            </Select>
          </Field>
          <Field id="rq-months" label="Months (rolling)" error={e.months}><Input id="rq-months" name="months" type="number" min={1} max={120} /></Field>
          <Field id="rq-month" label="Cycle ends: month (1-12)" error={e.month}><Input id="rq-month" name="month" type="number" min={1} max={12} /></Field>
          <Field id="rq-day" label="Cycle ends: day" error={e.day}><Input id="rq-day" name="day" type="number" min={1} max={31} /></Field>
          <Field id="rq-years" label="Years per cycle" error={e.years}><Input id="rq-years" name="years" type="number" min={1} max={10} /></Field>
        </div>
      )}
    </ActionForm>
  );
}

export function ArchiveForm({ kind, id, label }: { kind: 'category' | 'course' | 'requirement'; id: string; label: string }) {
  const key = id.slice(0, 8);
  return (
    <ActionForm action={archiveItem.bind(null, kind, id)} label={`Archive ${label}`} submitLabel={`Archive ${label}`} submitVariant="secondary" className="mt-2 space-y-2">
      {(e) => <Field id={`arch-${key}`} label="Why?" error={e.reason}><Input id={`arch-${key}`} name="reason" required /></Field>}
    </ActionForm>
  );
}
