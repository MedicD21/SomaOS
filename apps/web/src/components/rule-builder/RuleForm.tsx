'use client';
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { getAt, removeAt, setAt, type Doc } from './path';
import { SECTIONS, type FieldSpec, type RuleKindKey, type SectionSpec } from './specs';

export type Suggestions = { payCodes: string[]; banks: string[] };

type Props = {
  kind: RuleKindKey;
  doc: Doc;
  onChange: (next: Doc) => void;
  /** Field errors by dotted path (from the schema, live, plus any the server returned). */
  errors: Record<string, string>;
  suggestions: Suggestions;
};

const idOf = (prefix: string, path: string): string => `${prefix}-${path.replace(/[^a-zA-Z0-9]+/g, '-')}`;

function applyText(doc: Doc, spec: FieldSpec, raw: string): Doc {
  if (spec.set) return spec.set(doc, raw);
  if (raw === '') return spec.blank === 'remove' ? removeAt(doc, spec.path) : setAt(doc, spec.path, spec.blank === 'null' ? null : '');
  if (spec.input === 'number') {
    const n = Number(raw);
    return setAt(doc, spec.path, Number.isFinite(n) ? n : raw);
  }
  return setAt(doc, spec.path, raw);
}

function FieldView({ spec, doc, onChange, error, prefix }: { spec: FieldSpec; doc: Doc; onChange: (d: Doc) => void; error: string | undefined; prefix: string }) {
  const id = idOf(prefix, spec.path);
  const value = getAt(doc, spec.path);
  const describedBy = `${id}-hint${error ? ` ${id}-error` : ''}`;
  const listId = spec.suggest ? `${prefix}-list-${spec.suggest}` : undefined;
  const text = value === null || value === undefined ? '' : String(value);
  const help = (
    <>
      <p id={`${id}-hint`} className="text-sm text-muted">
        {spec.help}
        {spec.advice && <span className="block">{spec.advice}</span>}
      </p>
      {error && <p id={`${id}-error`} role="alert" className="text-sm text-danger">{error}</p>}
    </>
  );

  if (spec.input === 'toggle') {
    // An optional toggle that is absent behaves as "on" for countsTowardFlsa; show that honestly.
    const checked = spec.path.endsWith('countsTowardFlsa') ? value !== false : value === true;
    return (
      <div className="space-y-1">
        <label htmlFor={id} className="flex min-h-11 items-center gap-2 text-sm font-medium">
          <input
            id={id}
            type="checkbox"
            checked={checked}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            onChange={(e) => onChange(spec.blank === 'remove' && e.target.checked ? removeAt(doc, spec.path) : setAt(doc, spec.path, e.target.checked))}
          />
          {spec.label}
        </label>
        {help}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {spec.label}
        {spec.unit && <span className="font-normal text-muted"> ({spec.unit})</span>}
      </label>
      {spec.input === 'select' ? (
        <Select id={id} value={text} aria-describedby={describedBy} aria-invalid={error ? true : undefined} onChange={(e) => onChange(applyText(doc, spec, e.target.value))}>
          {spec.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      ) : (
        <Input
          id={id}
          type={spec.input === 'number' ? 'number' : spec.input === 'date' ? 'date' : 'text'}
          inputMode={spec.input === 'number' ? 'decimal' : undefined}
          value={text}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          list={listId}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(applyText(doc, spec, e.target.value))}
        />
      )}
      {help}
    </div>
  );
}

const EARN_DEFAULTS: Record<string, Record<string, unknown>> = {
  per_period: { method: 'per_period', hours: 0 },
  per_hours_worked: { method: 'per_hours_worked', perHours: 40, earnHours: 1 },
  annual_front_load: { method: 'annual_front_load', hours: 0 },
  manual: { method: 'manual' },
};

function NumberCell({ id, label, value, onSet, error, step = 1, min = 0 }: { id: string; label: string; value: unknown; onSet: (v: number | string) => void; error?: string | undefined; step?: number; min?: number }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <Input id={id} type="number" inputMode="decimal" value={typeof value === 'number' || typeof value === 'string' ? value : ''} min={min} step={step} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => { const n = Number(e.target.value); onSet(e.target.value !== '' && Number.isFinite(n) ? n : e.target.value); }} />
      {error && <p id={`${id}-error`} role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function TiersEditor({ doc, onChange, errors, prefix }: { doc: Doc; onChange: (d: Doc) => void; errors: Record<string, string>; prefix: string }) {
  const tiers = (Array.isArray(doc.tiers) ? doc.tiers : []) as { fromYears?: unknown; earn?: { method?: string } }[];
  return (
    <div className="space-y-3">
      {errors.tiers && <p role="alert" className="text-sm text-danger">{errors.tiers}</p>}
      <ul aria-label="Tiers" className="space-y-3">
        {tiers.map((t, i) => {
          const base = `tiers.${i}`;
          const method = t.earn?.method ?? 'per_period';
          return (
            <li key={i} className="space-y-3 rounded-lg border border-line p-3">
              <p className="text-sm font-semibold">Tier {i + 1}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberCell id={idOf(prefix, `${base}.fromYears`)} label="From (years of service)" value={t.fromYears} error={errors[`${base}.fromYears`]} onSet={(v) => onChange(setAt(doc, `${base}.fromYears`, v))} />
                <div className="space-y-1">
                  <label htmlFor={idOf(prefix, `${base}.method`)} className="block text-sm font-medium">How leave is earned</label>
                  <Select id={idOf(prefix, `${base}.method`)} value={method} onChange={(e) => onChange(setAt(doc, `${base}.earn`, EARN_DEFAULTS[e.target.value] ?? EARN_DEFAULTS.per_period))}>
                    <option value="per_period">A set number of hours each period</option>
                    <option value="per_hours_worked">Hours earned per hours worked</option>
                    <option value="annual_front_load">A yearly amount credited up front</option>
                    <option value="manual">Not automatic (adjusted by hand)</option>
                  </Select>
                </div>
                {(method === 'per_period' || method === 'annual_front_load') && (
                  <NumberCell id={idOf(prefix, `${base}.earn.hours`)} label={method === 'per_period' ? 'Hours earned each period' : 'Hours credited each year'} value={(t.earn as { hours?: unknown } | undefined)?.hours} step={0.5} error={errors[`${base}.earn.hours`]} onSet={(v) => onChange(setAt(doc, `${base}.earn.hours`, v))} />
                )}
                {method === 'per_hours_worked' && (
                  <>
                    <NumberCell id={idOf(prefix, `${base}.earn.earnHours`)} label="Hours earned" value={(t.earn as { earnHours?: unknown } | undefined)?.earnHours} step={0.25} error={errors[`${base}.earn.earnHours`]} onSet={(v) => onChange(setAt(doc, `${base}.earn.earnHours`, v))} />
                    <NumberCell id={idOf(prefix, `${base}.earn.perHours`)} label="For every this many hours worked" value={(t.earn as { perHours?: unknown } | undefined)?.perHours} step={1} min={1} error={errors[`${base}.earn.perHours`]} onSet={(v) => onChange(setAt(doc, `${base}.earn.perHours`, v))} />
                  </>
                )}
              </div>
              <Button type="button" variant="secondary" disabled={tiers.length <= 1} onClick={() => onChange(removeAt(doc, base))}>Remove tier {i + 1}</Button>
            </li>
          );
        })}
      </ul>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          const last = tiers[tiers.length - 1];
          const from = typeof last?.fromYears === 'number' ? last.fromYears + 1 : 0;
          onChange(setAt(doc, 'tiers', [...tiers, { fromYears: from, earn: { method: 'per_period', hours: 0 } }]));
        }}
      >
        Add a tier
      </Button>
    </div>
  );
}

function FractionsEditor({ doc, onChange, errors, prefix }: { doc: Doc; onChange: (d: Doc) => void; errors: Record<string, string>; prefix: string }) {
  const map = (typeof doc.fractionByEmploymentType === 'object' && doc.fractionByEmploymentType !== null ? doc.fractionByEmploymentType : {}) as Record<string, unknown>;
  const entries = Object.entries(map);
  const write = (next: [string, unknown][]) => onChange(setAt(doc, 'fractionByEmploymentType', Object.fromEntries(next)));
  return (
    <div className="space-y-3">
      {entries.length === 0 && <p className="text-sm text-muted">Everyone earns the full amount.</p>}
      <ul aria-label="Part-time fractions" className="space-y-3">
        {entries.map(([type, f], i) => (
          <li key={i} className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor={idOf(prefix, `fraction-${i}-type`)} className="block text-sm font-medium">Employment type</label>
              <Input id={idOf(prefix, `fraction-${i}-type`)} value={type} onChange={(e) => write(entries.map(([k, v], n) => (n === i ? [e.target.value, v] : [k, v])))} />
            </div>
            <NumberCell
              id={idOf(prefix, `fraction-${i}-pct`)}
              label="Earns this percent of the normal amount"
              value={typeof f === 'number' ? Math.round(f * 10000) / 100 : f}
              min={1}
              error={errors[`fractionByEmploymentType.${type}`]}
              onSet={(v) => write(entries.map(([k, old], n) => (n === i ? [k, typeof v === 'number' ? v / 100 : v] : [k, old])))}
            />
            <Button type="button" variant="secondary" onClick={() => write(entries.filter((_, n) => n !== i))}>Remove {type || 'row'}</Button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="secondary" onClick={() => write([...entries, [entries.some(([k]) => k === 'career_part_time') ? `type_${entries.length + 1}` : 'career_part_time', 0.5]])}>
        Add a part-time fraction
      </Button>
    </div>
  );
}

function SectionView({ section, ...p }: { section: SectionSpec } & Omit<Props, 'kind'> & { prefix: string }) {
  const visible = section.fields.filter((f) => !f.when || getAt(p.doc, f.when.path) === f.when.equals);
  const heading = `${p.prefix}-sec-${section.id}`;
  return (
    <section aria-labelledby={heading} className="space-y-3 rounded-lg border border-line p-4">
      <h4 id={heading} className="text-base font-semibold">{section.title}</h4>
      {section.intro && <p className="text-sm text-muted">{section.intro}</p>}
      {section.custom === 'tiers' && <TiersEditor doc={p.doc} onChange={p.onChange} errors={p.errors} prefix={p.prefix} />}
      {section.custom === 'fractions' && <FractionsEditor doc={p.doc} onChange={p.onChange} errors={p.errors} prefix={p.prefix} />}
      {visible.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {visible.map((f) => (
            <FieldView key={f.path} spec={f} doc={p.doc} onChange={p.onChange} error={p.errors[f.path]} prefix={p.prefix} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Guided form for one rule document. Edits the same JSON the Advanced view shows. */
export function RuleForm({ kind, doc, onChange, errors, suggestions }: Props) {
  const prefix = useId().replace(/:/g, '');
  return (
    <div className="space-y-4">
      {SECTIONS[kind].map((s) => <SectionView key={s.id} section={s} doc={doc} onChange={onChange} errors={errors} suggestions={suggestions} prefix={prefix} />)}
      <datalist id={`${prefix}-list-payCodes`}>{suggestions.payCodes.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id={`${prefix}-list-banks`}>{suggestions.banks.map((c) => <option key={c} value={c} />)}</datalist>
    </div>
  );
}
