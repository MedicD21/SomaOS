'use client';
import { useMemo, useState } from 'react';
import { describeAccrualPolicy, describePayRules, type AccrualPolicy, type PayRules } from '@soma/schedule-engine';
import { accrualPolicySchema, issuesToFieldErrors, parseJsonDocument, payRulesSchema, unknownPaths } from '@soma/validators';
import { ActionForm, type ActionResult } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { CompareVersions, type VersionView } from './CompareVersions';
import type { Doc } from './path';
import { RuleForm, type Suggestions } from './RuleForm';
import { AccrualSimInputs, PaySimInputs } from './SimInputs';
import { ApproveBox, SimulatePanel, useSimulation } from './Simulate';
import type { SimState } from './sim-types';

type Opt = { id: string; label: string };
type Mode = 'form' | 'json';

export type WorkbenchActions = {
  save: (key: string, prev: ActionResult, form: FormData) => Promise<ActionResult>;
  simulate: (key: string, version: number, prev: SimState, form: FormData) => Promise<SimState>;
  approve: (key: string, version: number, prev: ActionResult, form: FormData) => Promise<ActionResult>;
};

type Props = {
  kind: 'pay' | 'accrual';
  /** Group key (pay) or leave bank key (accrual). */
  uid: string;
  label: string;
  initial: Doc;
  draftVersion: number | null;
  savedPayload: Doc | null;
  versions: VersionView[];
  suggestions: Suggestions;
  members: Opt[];
  canApprove: boolean;
  actions: WorkbenchActions;
};

const NAMES = {
  pay: { field: 'rules', json: 'Rules (JSON)', save: (l: string) => `Edit pay rules for ${l}`, approve: (l: string, v: number) => `Approve pay rules for ${l} v${v}`, approveSubmit: 'Approve rules', sim: (l: string) => `Simulate pay rules for ${l}` },
  accrual: { field: 'policy', json: 'Policy (JSON)', save: (l: string) => `Edit ${l} policy`, approve: (l: string, v: number) => `Approve ${l} policy v${v}`, approveSubmit: 'Approve policy', sim: (l: string) => `Simulate ${l} policy` },
} as const;

const canonical = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

/** One rule document: guided form or JSON, what it means, simulate against the approved rules, compare, approve. */
export function RuleWorkbench(p: Props) {
  const names = NAMES[p.kind];
  const schema = p.kind === 'pay' ? payRulesSchema : accrualPolicySchema;
  const [mode, setMode] = useState<Mode>('form');
  const [doc, setDoc] = useState<Doc>(p.initial);
  const [text, setText] = useState(() => JSON.stringify(p.initial, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const typed = useMemo(() => (mode === 'form' ? { ok: true as const, value: doc as unknown } : parseJsonDocument(text)), [mode, doc, text]);
  const checked = useMemo(() => (typed.ok ? schema.safeParse(typed.value) : null), [typed, schema]);
  const clientErrors = useMemo(() => (checked && !checked.success ? issuesToFieldErrors(checked.error.issues) : {}), [checked]);
  const extra = useMemo(() => (checked?.success && typed.ok ? unknownPaths(typed.value, checked.data) : []), [checked, typed]);
  const lines = useMemo(() => {
    if (!checked?.success) return null;
    return p.kind === 'pay' ? describePayRules(checked.data as PayRules) : describeAccrualPolicy(checked.data as AccrualPolicy);
  }, [checked, p.kind]);

  const valid = checked?.success === true;
  const dirty = p.savedPayload === null || !typed.ok || canonical(typed.value) !== canonical(p.savedPayload);
  const draftKey = canonical(p.savedPayload);
  const sim = useSimulation(
    (prev, form) => p.actions.simulate(p.uid, p.draftVersion ?? 0, prev, form),
    draftKey,
  );
  const blocked = dirty ? 'Save your changes first: the simulation runs the saved draft.' : null;
  const serialized = mode === 'form' ? JSON.stringify(doc, null, 2) : text;

  const toForm = () => {
    const r = parseJsonDocument(text);
    if (!r.ok) return setJsonError(r.error);
    if (typeof r.value !== 'object' || r.value === null || Array.isArray(r.value)) return setJsonError('The document must be a JSON object.');
    setJsonError(null);
    setDoc(r.value as Doc);
    setMode('form');
  };
  const toJson = () => {
    setText(JSON.stringify(doc, null, 2));
    setJsonError(null);
    setMode('json');
  };

  return (
    <div className="space-y-8">
      <ActionForm action={p.actions.save.bind(null, p.uid)} label={names.save(p.label)} submitLabel="Save draft">
        {(serverErrors) => {
          const errors = { ...clientErrors, ...serverErrors };
          return (
            <div className="space-y-4">
              <div role="group" aria-label="Editor view" className="flex flex-wrap gap-2">
                <Button type="button" variant={mode === 'form' ? 'primary' : 'secondary'} aria-pressed={mode === 'form'} onClick={mode === 'form' ? undefined : toForm}>Guided form</Button>
                <Button type="button" variant={mode === 'json' ? 'primary' : 'secondary'} aria-pressed={mode === 'json'} onClick={mode === 'json' ? undefined : toJson}>Advanced JSON</Button>
              </div>
              {jsonError && <p role="alert" className="text-sm text-danger">{jsonError}</p>}
              {mode === 'form' ? (
                <>
                  <input type="hidden" name={names.field} value={serialized} />
                  <RuleForm kind={p.kind} doc={doc} onChange={setDoc} errors={errors} suggestions={p.suggestions} />
                </>
              ) : (
                <Field id={`${p.uid}-json`} label={names.json} hint="The same document the guided form edits. Switching views never loses anything." error={serverErrors[names.field] ?? (typed.ok ? undefined : typed.error)}>
                  <textarea
                    id={`${p.uid}-json`}
                    name={names.field}
                    rows={20}
                    spellCheck={false}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    className="block w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm"
                  />
                </Field>
              )}
              {extra.length > 0 && (
                <p role="status" className="text-sm font-medium">
                  These settings are not used by the rules: {extra.join(', ')}. They are kept as written when you save.
                </p>
              )}
              <section aria-label="What this means" className="rounded-lg border border-line p-4">
                <h4 className="mb-2 text-base font-semibold">What this means</h4>
                {lines ? (
                  <ul aria-label="What these settings mean" className="list-disc space-y-1 pl-5 text-sm">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
                ) : (
                  <p className="text-sm text-muted">Fix the highlighted settings to see what they mean in plain English.</p>
                )}
              </section>
            </div>
          );
        }}
      </ActionForm>

      <section aria-label={`Simulate ${p.label}`} className="space-y-3">
        <h4 className="text-base font-semibold">Simulate before approving</h4>
        <SimulatePanel title={names.sim(p.label)} version={p.draftVersion} blocked={!valid ? 'Fix the highlighted settings first.' : blocked} sim={sim}>
          {p.kind === 'pay'
            ? <PaySimInputs uid={p.uid} members={p.members} errors={sim.state.fieldErrors ?? {}} />
            : <AccrualSimInputs uid={p.uid} members={p.members} errors={sim.state.fieldErrors ?? {}} />}
        </SimulatePanel>
      </section>

      <section aria-label={`Compare versions of ${p.label}`} className="space-y-3">
        <h4 className="text-base font-semibold">Compare versions</h4>
        <CompareVersions key={p.versions.map((v) => `${v.version}:${v.status}`).join(',')} uid={p.uid} kind={p.kind} versions={p.versions} />
      </section>

      {p.draftVersion !== null && p.canApprove && (
        <ApproveBox
          label={names.approve(p.label, p.draftVersion)}
          submitLabel={names.approveSubmit}
          action={p.actions.approve.bind(null, p.uid, p.draftVersion)}
          token={dirty ? '' : sim.token}
          hint={p.kind === 'pay' ? 'Pay periods starting on or after this date use these rules.' : 'Accruals are posted for every completed period from this date, up to two years back.'}
        />
      )}
      {p.draftVersion !== null && !p.canApprove && <p className="text-sm text-muted">Approving needs configuration approval permission.</p>}
    </div>
  );
}
