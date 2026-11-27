import Link from 'next/link';
import { addDays, localDateOf, MANDATE_STATUS_LABEL, startOfLocalDay } from '@soma/schedule-engine';
import { Forbidden } from '@/components/forbidden';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { check, getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { loadPatterns } from '@/server/scheduling/load';
import {
  listMandateLists,
  loadAddableMembers,
  loadMandateEntries,
  loadMandateHistory,
  type MandateEntryView,
} from '@/server/scheduling/mandate';
import { loadRoster } from '@/server/scheduling/roster';
import { evaluateStaffingDay } from '@/server/scheduling/staffing';
import { AddMemberForm, CreateListForm, MandateForm, OrderEditor, type EntryRow } from './forms';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EVENT_LABEL: Record<string, string> = {
  added: 'Added',
  removed: 'Removed',
  reordered: 'Order changed',
  exempted: 'Exempted',
  unexempted: 'Exemption cleared',
  skipped: 'Skipped',
  mandated: 'Mandated',
};

function isValidDate(d: string): boolean {
  return DATE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);
}

function detail(e: MandateEntryView): string | null {
  if (e.status === 'exempt') return `${e.exemptReason ?? ''}${e.exemptUntil ? ` (until ${e.exemptUntil})` : ''}`;
  return null;
}

export default async function MandatePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('scheduling')) return <Forbidden reason="Scheduling is not enabled for this department." />;
  if (!hasAny(ctx, 'scheduling.roster.view') && !hasAny(ctx, 'scheduling.mandate.manage')) {
    return <Forbidden reason="no active grant for scheduling.roster.view" />;
  }
  const canManage = check(ctx, 'scheduling.mandate.manage').allowed;
  const tz = ctx.tenant.timezone;
  const today = localDateOf(new Date(), tz);
  const date = sp.date && isValidDate(sp.date) ? sp.date : today;

  const data = await withCtxDb(ctx, async (tx) => {
    const lists = await listMandateLists(tx);
    const list = lists.find((l) => sp.list && UUID.test(sp.list) && l.id === sp.list) ?? lists[0] ?? null;
    const staffing = await evaluateStaffingDay(tx, date);
    const short = staffing?.evaluation.department.find((d) => !d.met) ?? staffing?.evaluation.department[0] ?? null;
    const entries = list ? await loadMandateEntries(tx, list.id, date, staffing?.rules ?? null, short?.group ?? null) : [];
    const history = list ? await loadMandateHistory(tx, list.id) : [];
    const addable = list && canManage ? await loadAddableMembers(tx, list.id) : [];
    const roster = canManage ? await loadRoster(tx, date, null) : { units: [] };
    const seats = roster.units
      .filter((u) => check(ctx, 'scheduling.roster.edit', { orgUnitPath: u.path }).allowed)
      .flatMap((u) => u.seats.filter((s) => s.seat.required && !s.assignment).map((s) => ({ id: s.seat.id, label: `${u.name} — ${s.seat.label}` })));
    const dayEnd = startOfLocalDay(addDays(date, 1), tz).getTime();
    const pattern = (await loadPatterns(tx)).filter((p) => p.effectiveFrom.getTime() < dayEnd).at(-1)?.payload;
    return { lists, list, staffing, short, entries, history, addable, seats, shiftStart: pattern?.shiftStart ?? '07:00', shiftHours: pattern?.shiftHours ?? 24 };
  });
  const { lists, list, staffing, short, entries, history, addable, seats } = data;
  const holes = short?.shortfall ?? 0;
  const eligible = entries.filter((e) => e.status === 'eligible');
  const suggested = eligible.slice(0, Math.max(holes, 1));
  const rows: EntryRow[] = entries.map((e) => ({
    memberId: e.memberId,
    name: e.name,
    position: e.position,
    status: e.status,
    statusLabel: MANDATE_STATUS_LABEL[e.status],
    detail: detail(e),
    exempt: e.exemptReason !== null,
  }));

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">Mandate list</h1>
        <form method="get" action="/mandate" aria-label="Choose date" className="flex flex-wrap items-end gap-2">
          {list && <input type="hidden" name="list" value={list.id} />}
          <Field id="mandate-date" label="Date">
            <Input id="mandate-date" name="date" type="date" defaultValue={date} required />
          </Field>
          <Button type="submit" variant="secondary">Go</Button>
        </form>
      </div>

      <Card title="Staffing">
        {!staffing ? (
          <p className="text-sm">
            No staffing rules are approved yet, so nothing is checked. An administrator sets them under Admin → Scheduling → Staffing rules.
          </p>
        ) : (
          <div className="space-y-2">
            {staffing.evaluation.department.map((d) => (
              <p key={d.group} className={`font-semibold ${d.met ? '' : 'text-danger'}`}>
                <span data-testid={`dept-${d.group}`}>{`${d.count}/${d.min}`}</span> {d.label} on duty on {date}
                {d.met ? ' — minimum met.' : ` — ${d.shortfall} below the minimum.`}
              </p>
            ))}
            {holes > 0 ? (
              <p role="status" className="text-sm">
                {suggested.length > 0
                  ? `Next up: ${suggested.map((s) => s.name).join('; ')}.`
                  : 'Nobody on this list can be mandated for this date.'}
              </p>
            ) : (
              <p className="text-sm text-muted">No mandate is needed for the department minimum. Use temporary transfers on the roster for short units.</p>
            )}
          </div>
        )}
      </Card>

      <Card title="Lists">
        {lists.length === 0 ? (
          <p className="mb-4 text-sm">No mandate lists yet.</p>
        ) : (
          <ul className="mb-4 flex flex-wrap gap-2">
            {lists.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/mandate?${new URLSearchParams({ list: l.id, date })}`}
                  aria-current={l.id === list?.id ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center rounded-md border border-line px-4 text-sm ${l.id === list?.id ? 'font-semibold' : ''}`}
                >
                  {l.name} ({l.size})
                </Link>
              </li>
            ))}
          </ul>
        )}
        {canManage && <CreateListForm />}
      </Card>

      {list && (
        <>
          <Card title={list.name}>
            {entries.length === 0 ? (
              <p className="text-sm">Nobody is on this list yet.</p>
            ) : (
              <OrderEditor key={rows.map((r) => `${r.memberId}:${r.status}:${r.exempt}`).join(',')} listId={list.id} entries={rows} canManage={canManage} date={date} />
            )}
          </Card>

          {canManage && (
            <Card title="Mandate">
              {seats.length === 0 ? (
                <p className="text-sm">No vacant seats you can fill on {date}. <Link href={`/roster?date=${date}`} className="underline">Open the roster</Link>.</p>
              ) : (
                <MandateForm
                  key={eligible.map((e) => e.memberId).join(',')}
                  listId={list.id}
                  candidates={entries.filter((e) => e.status === 'eligible').map((e) => ({ id: e.memberId, label: e.name }))}
                  nextId={eligible[0]?.memberId ?? null}
                  seats={seats}
                  date={date}
                  startTime={data.shiftStart}
                  hours={data.shiftHours}
                  canOverride={check(ctx, 'scheduling.qualification.override').allowed}
                />
              )}
            </Card>
          )}

          {canManage && (
            <Card title="Add a member">
              <AddMemberForm listId={list.id} members={addable.map((m) => ({ id: m.id, label: m.name }))} />
            </Card>
          )}

          <Card title="History">
            {history.length === 0 ? (
              <p className="text-sm">No changes yet.</p>
            ) : (
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Mandate history">
                <table className="w-full min-w-[32rem] text-left text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="py-2 pr-3">When</th>
                      <th scope="col" className="pr-3">What</th>
                      <th scope="col" className="pr-3">Member</th>
                      <th scope="col" className="pr-3">Reason</th>
                      <th scope="col">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} className="border-t border-line align-top">
                        <td className="py-2 pr-3">{h.at.toLocaleString('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })}</td>
                        <td className="pr-3">{EVENT_LABEL[h.kind] ?? h.kind}{h.onDate ? ` (${h.onDate})` : ''}</td>
                        <td className="pr-3">{h.memberName ?? '—'}</td>
                        <td className="pr-3">{h.reason ?? '—'}</td>
                        <td>{h.by ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
