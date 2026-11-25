'use client';
import { describePattern, type ShiftPattern } from '@soma/schedule-engine';
import type { ActionResult } from '@/components/action-form';
import { CompareVersions, type VersionView } from './CompareVersions';
import { PatternSimInputs } from './SimInputs';
import { ApproveBox, SimulatePanel, useSimulation } from './Simulate';
import type { SimState } from './sim-types';

const canonical = (v: unknown): string => JSON.stringify(v);

/**
 * Around the guided pattern form: what the saved draft means, a day-by-day comparison with the approved pattern,
 * a version diff, and the simulation-gated approve form.
 */
export function PatternWorkbench({
  draftVersion, savedPayload, versions, shifts, canApprove, defaultDate, simulate, approve,
}: {
  draftVersion: number | null;
  savedPayload: ShiftPattern | null;
  versions: VersionView[];
  shifts: { key: string; label: string }[];
  canApprove: boolean;
  defaultDate: string;
  simulate: (version: number, prev: SimState, form: FormData) => Promise<SimState>;
  approve: (version: number, prev: ActionResult, form: FormData) => Promise<ActionResult>;
}) {
  const sim = useSimulation((prev, form) => simulate(draftVersion ?? 0, prev, form), canonical(savedPayload));
  const shiftKeys = shifts.map((s) => s.key);
  return (
    <div className="space-y-8">
      {savedPayload && (
        <section aria-label="What the saved draft means" className="rounded-lg border border-line p-4">
          <h4 className="mb-2 text-base font-semibold">What the saved draft means</h4>
          <ul aria-label="What this pattern means" className="list-disc space-y-1 pl-5 text-sm">
            {describePattern(savedPayload, shiftKeys).map((l) => <li key={l}>{l}</li>)}
          </ul>
        </section>
      )}

      <section aria-label="Simulate the draft pattern" className="space-y-3">
        <h4 className="text-base font-semibold">Simulate before approving</h4>
        <SimulatePanel title="Simulate the draft pattern" version={draftVersion} blocked={null} sim={sim}>
          <PatternSimInputs uid="pattern" shifts={shifts} errors={sim.state.fieldErrors ?? {}} />
        </SimulatePanel>
      </section>

      <section aria-label="Compare pattern versions" className="space-y-3">
        <h4 className="text-base font-semibold">Compare versions</h4>
        <CompareVersions key={versions.map((v) => `${v.version}:${v.status}`).join(',')} uid="pattern" kind="pattern" versions={versions} shiftKeys={shiftKeys} />
      </section>

      {draftVersion !== null && canApprove && (
        <ApproveBox
          label="Approve pattern"
          submitLabel={`Approve v${draftVersion}`}
          action={approve.bind(null, draftVersion)}
          token={sim.token}
          defaultDate={defaultDate}
          hint="The current version ends the day before. Generated shifts from this date are withdrawn; regenerate afterwards to recreate them."
        />
      )}
    </div>
  );
}
