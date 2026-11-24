import { Field, Input, Select } from '@/components/ui/field';

export type CustomFieldView = {
  key: string;
  label: string;
  type: string;
  options?: { value: string; label: string }[];
  required: boolean;
};

export function CustomFieldInputs({ defs, values = {}, errors, idPrefix }: {
  defs: CustomFieldView[];
  values?: Record<string, unknown>;
  errors: Record<string, string>;
  idPrefix: string;
}) {
  if (defs.length === 0) return null;
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <legend className="mb-2 font-semibold">Department fields</legend>
      {defs.map((d) => {
        const id = `${idPrefix}-cf-${d.key}`;
        const name = `custom.${d.key}`;
        const v = values[d.key];
        const err = errors[name];
        const label = d.required ? `${d.label}` : `${d.label} (optional)`;
        if (d.type === 'boolean')
          return (
            <label key={d.key} className="flex items-center gap-2">
              <input type="checkbox" name={name} defaultChecked={v === true} /> {d.label}
            </label>
          );
        if (d.type === 'select')
          return (
            <Field key={d.key} id={id} label={label} error={err}>
              <Select id={id} name={name} defaultValue={typeof v === 'string' ? v : ''}>
                <option value="">—</option>
                {d.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </Field>
          );
        if (d.type === 'multi_select')
          return (
            <fieldset key={d.key}>
              <legend className="text-sm font-medium">{label}</legend>
              {d.options?.map((o) => (
                <label key={o.value} className="mr-3 inline-flex items-center gap-1">
                  <input type="checkbox" name={name} value={o.value} defaultChecked={Array.isArray(v) && v.includes(o.value)} /> {o.label}
                </label>
              ))}
              {err && <p className="text-sm text-danger">{err}</p>}
            </fieldset>
          );
        const type = d.type === 'date' ? 'date' : d.type === 'number' || d.type === 'integer' ? 'number' : d.type === 'email' ? 'email' : d.type === 'phone' ? 'tel' : 'text';
        return (
          <Field key={d.key} id={id} label={label} error={err}>
            <Input id={id} name={name} type={type} step={d.type === 'number' ? 'any' : undefined} defaultValue={v == null ? '' : String(v)} />
          </Field>
        );
      })}
    </fieldset>
  );
}
