'use client';
import { useState } from 'react';
import { coerceAnswers, isFieldVisible, type FormField } from '@soma/validators';
import { Field, Input, Select } from '@/components/ui/field';

type Values = Record<string, string | string[]>;

/** Starting values (as text) from stored answers, so a correction opens with the original answers filled in. */
export function valuesFromAnswers(fields: FormField[], answers: Record<string, unknown> | undefined): Values {
  const out: Values = {};
  for (const f of fields) {
    const a = answers?.[f.key];
    if (a === undefined || a === null) continue;
    out[f.key] = Array.isArray(a) ? a.map(String) : String(a);
  }
  return out;
}

/**
 * Renders a form definition. Fields hidden by `show_if` are not rendered, so their values are never submitted.
 * Used for filling in, correcting and previewing a form (preview passes `idPrefix` so ids stay unique).
 */
export function FormFields({ fields, defaults, idPrefix = 'ff' }: { fields: FormField[]; defaults?: Values; idPrefix?: string }) {
  const [vals, setVals] = useState<Values>(defaults ?? {});
  const typed = coerceAnswers(fields, vals);
  const set = (key: string, v: string | string[]) => setVals((p) => ({ ...p, [key]: v }));

  return (
    <div className="space-y-4">
      {fields.filter((f) => isFieldVisible(f, typed)).map((f) => {
        const id = `${idPrefix}-${f.key}`;
        const label = f.required ? `${f.label} (required)` : f.label;
        const value = vals[f.key];
        if (f.type === 'boolean') {
          return (
            <fieldset key={f.key} className="space-y-1">
              <legend className="text-sm font-medium">{label}</legend>
              <div className="flex gap-4">
                {(['true', 'false'] as const).map((opt) => (
                  <label key={opt} className="flex min-h-11 items-center gap-2">
                    <input type="radio" name={f.key} value={opt} checked={value === opt} onChange={() => set(f.key, opt)} /> {opt === 'true' ? 'Yes' : 'No'}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        }
        if (f.type === 'multi_select') {
          const chosen = Array.isArray(value) ? value : [];
          return (
            <fieldset key={f.key} className="space-y-1">
              <legend className="text-sm font-medium">{label}</legend>
              {(f.options ?? []).map((o) => (
                <label key={o.value} className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox" name={f.key} value={o.value} checked={chosen.includes(o.value)}
                    onChange={(e) => set(f.key, e.target.checked ? [...chosen, o.value] : chosen.filter((c) => c !== o.value))}
                  /> {o.label}
                </label>
              ))}
            </fieldset>
          );
        }
        const text = typeof value === 'string' ? value : '';
        return (
          <Field key={f.key} id={id} label={label}>
            {f.type === 'long_text' ? (
              <textarea id={id} name={f.key} rows={4} value={text} onChange={(e) => set(f.key, e.target.value)}
                className="block w-full min-h-11 rounded-md border border-line bg-surface px-3 py-2 text-fg" />
            ) : f.type === 'select' ? (
              <Select id={id} name={f.key} value={text} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">— Choose —</option>
                {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            ) : (
              <Input
                id={id} name={f.key} value={text} onChange={(e) => set(f.key, e.target.value)}
                type={f.type === 'date' ? 'date' : f.type === 'number' || f.type === 'integer' ? 'number' : f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text'}
                step={f.type === 'integer' ? 1 : f.type === 'number' ? 'any' : undefined}
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}
