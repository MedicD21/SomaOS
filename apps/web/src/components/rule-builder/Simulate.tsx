'use client';
import { startTransition, useActionState, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { SimulationResult } from './SimulationResult';
import type { SimState } from './sim-types';

type SimAction = (prev: SimState, form: FormData) => Promise<SimState>;

/**
 * Runs a simulate action and keeps the token it returned. The token is only offered while the stored draft is
 * still the one that was simulated (`draftKey` changes whenever the draft is saved again).
 */
export function useSimulation(action: SimAction, draftKey: string) {
  const [state, formAction, pending] = useActionState<SimState, FormData>(action, { ok: null, message: null });
  const [simulatedKey, setSimulatedKey] = useState<string | null>(null);
  useEffect(() => {
    if (state.token) setSimulatedKey(draftKey);
    // Only a new result changes what was simulated; later edits to draftKey must not re-arm an old token.
  }, [state.token]);
  const fresh = Boolean(state.token) && simulatedKey === draftKey;
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };
  return { state, pending, onSubmit, token: fresh ? (state.token ?? '') : '', stale: Boolean(state.token) && !fresh };
}

export function SimulatePanel({
  title, version, blocked, sim, children,
}: { title: string; version: number | null; blocked: string | null; sim: ReturnType<typeof useSimulation>; children: ReactNode }) {
  const { state, pending, onSubmit } = sim;
  if (version === null) {
    return <p className="text-sm text-muted">Save a draft to simulate it against the approved rules.</p>;
  }
  return (
    <div className="space-y-4">
      <form aria-label={title} onSubmit={onSubmit} className="space-y-4" noValidate>
        <p className="text-sm text-muted">
          Runs the saved draft (v{version}) and the approved rules over the same data and shows both. Nothing is saved or changed.
        </p>
        {children}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="secondary" disabled={pending || blocked !== null}>Simulate draft v{version}</Button>
          {blocked && <p className="text-sm text-muted">{blocked}</p>}
          {state.message && (
            <p role={state.ok ? 'status' : 'alert'} className={`text-sm font-medium ${state.ok ? '' : 'text-danger'}`}>{state.message}</p>
          )}
        </div>
      </form>
      {sim.stale && <p role="status" className="text-sm font-medium">The draft changed since this simulation. Simulate it again before approving.</p>}
      {state.sim && <SimulationResult sim={state.sim} />}
    </div>
  );
}

/** The approve form: needs a fresh simulation token for this exact draft, and the server checks it again. */
export function ApproveBox({
  label, submitLabel, action, token, hint, defaultDate,
}: {
  label: string;
  submitLabel: string;
  action: (prev: { ok: boolean | null; message: string | null; fieldErrors?: Record<string, string> }, form: FormData) => Promise<{ ok: boolean | null; message: string | null; fieldErrors?: Record<string, string> }>;
  token: string;
  hint: string;
  defaultDate?: string;
}) {
  const id = `${label.replace(/\W+/g, '-')}-date`;
  return (
    <ActionForm action={action} label={label} submitLabel={submitLabel} submitDisabled={token === ''}>
      {(e) => (
        <>
          <input type="hidden" name="simToken" value={token} />
          <Field id={id} label="Takes effect on" hint={hint} error={e.effectiveFrom}>
            <Input id={id} name="effectiveFrom" type="date" defaultValue={defaultDate} required />
          </Field>
          {token === '' && <p className="text-sm text-muted">Simulate this draft first; approval needs a simulation of exactly this version.</p>}
        </>
      )}
    </ActionForm>
  );
}
