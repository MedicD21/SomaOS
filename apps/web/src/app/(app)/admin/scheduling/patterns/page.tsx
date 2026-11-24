import { addDays, expandPattern, localDateOf, type ShiftPattern } from '@soma/schedule-engine';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, t, withCtxDb } from '@/server/context';
import { listPatternVersions, type PatternVersion } from '@/server/scheduling/patterns';
import { ApproveForm, PatternForm } from './forms';

const PREVIEW_DAYS = 14;

const FALLBACK: ShiftPattern = {
  cycle: ['on', 'off', 'off'],
  shiftStart: '07:00',
  shiftHours: 24,
  anchorDate: '2026-01-01',
  platoons: {},
};

function range(v: PatternVersion): string {
  if (v.status === 'draft') return 'not yet effective';
  if (!v.fromDate && !v.toDate) return 'always';
  return [v.fromDate && `from ${v.fromDate}`, v.toDate ? `to ${v.toDate}` : 'onward'].filter(Boolean).join(' ');
}

function summary(p: ShiftPattern): string {
  const kelly = p.kelly ? `, Kelly every ${p.kelly.everyNthShift}th shift` : '';
  return `${p.cycle.map((c) => (c === 'on' ? 'on' : 'off')).join('/')} · ${p.shiftStart} · ${p.shiftHours} h${kelly}`;
}

function shortDate(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default async function PatternsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const approved = /^\d{1,6}$/.test(sp.approved ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? '') && /^\d{1,9}$/.test(sp.cancelled ?? '')
    ? { version: sp.approved!, from: sp.from!, cancelled: sp.cancelled! }
    : null;
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('scheduling')) return <Forbidden reason="Scheduling is not enabled for this department." />;
  const d = check(ctx, 'scheduling.config.manage');
  if (!d.allowed) return <Forbidden reason={d.reason} />;
  const canApprove = check(ctx, 'admin.config.manage').allowed && check(ctx, 'scheduling.roster.edit').allowed;
  const tz = ctx.tenant.timezone;
  const platoonLabel = t(ctx, 'shift', 'Shift');

  const { versions, shifts } = await withCtxDb(ctx, async (tx) => ({
    versions: await listPatternVersions(tx),
    shifts: [...(await tx<{ key: string; label: string }[]>`select key, label from shifts order by sort, label`)],
  }));
  const draft = versions.find((v) => v.status === 'draft');
  const today = localDateOf(new Date(), tz);
  const current = versions.find((v) => v.status === 'approved' && (!v.fromDate || v.fromDate <= today) && (!v.toDate || today <= v.toDate))
    ?? versions.find((v) => v.status === 'approved');
  const base = draft ?? current;
  const payload = base?.payload ?? FALLBACK;

  const days = Array.from({ length: PREVIEW_DAYS }, (_, i) => addDays(today, i));
  const onDuty = new Map<string, Map<string, string>>();
  for (const s of shifts) {
    const m = new Map<string, string>();
    if (payload.platoons[s.key] !== undefined) {
      for (const inst of expandPattern(payload, s.key, today, addDays(today, PREVIEW_DAYS), tz)) {
        const clock = (x: Date) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(x);
        m.set(inst.date, `${clock(inst.start)}–${clock(inst.end)}`);
      }
    }
    onDuty.set(s.key, m);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Shift patterns</h1>
      {approved && (
        <p role="status" className="rounded-lg border border-line bg-surface p-4 text-sm font-medium">
          Approved v{approved.version} effective {approved.from}; cancelled {approved.cancelled} generated shifts from that date.
          Regenerate the schedule on the roster page to recreate them.
        </p>
      )}

      <Card title="Versions">
        <div className="relative overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Pattern versions</caption>
            <thead>
              <tr>
                <th scope="col" className="py-2 pr-3">Version</th>
                <th scope="col" className="pr-3">Status</th>
                <th scope="col" className="pr-3">Effective</th>
                <th scope="col">Pattern</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-t border-line align-top">
                  <th scope="row" className="py-2 pr-3 font-medium">v{v.version}</th>
                  <td className="py-2 pr-3">{v.status}</td>
                  <td className="py-2 pr-3">{range(v)}</td>
                  <td className="py-2 break-words">{summary(v.payload)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={draft ? `Edit draft v${draft.version}` : 'New draft version'}>
        <p className="mb-4 text-sm text-muted">
          {draft
            ? 'Changes stay in this draft until it is approved.'
            : `Saving creates a draft copy of ${current ? `v${current.version}` : 'the pattern'}; the approved version is not changed.`}
        </p>
        <PatternForm initial={payload} shifts={shifts} platoonLabel={platoonLabel} />
      </Card>

      {draft && (
        <Card title={`Approve draft v${draft.version}`}>
          {canApprove ? (
            <ApproveForm version={draft.version} defaultDate={addDays(today, 1)} />
          ) : (
            <p className="text-sm text-muted">Approving needs the configuration approval and department roster edit permissions.</p>
          )}
        </Card>
      )}

      <Card title={`Preview: next ${PREVIEW_DAYS} days (${base ? `${base.status === 'draft' ? 'draft' : 'approved'} v${base.version}` : 'default'})`}>
        <div className="relative overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Preview of the next {PREVIEW_DAYS} days by {platoonLabel.toLowerCase()}</caption>
            <thead>
              <tr>
                <th scope="col" className="py-2 pr-3">Date</th>
                {shifts.map((s) => <th key={s.key} scope="col" className="pr-3">{s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day} className="border-t border-line">
                  <th scope="row" className="py-2 pr-3 font-medium whitespace-nowrap">{shortDate(day)}</th>
                  {shifts.map((s) => {
                    const on = onDuty.get(s.key)?.get(day);
                    return <td key={s.key} className="py-2 pr-3">{on ?? <span className="text-muted">off</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
