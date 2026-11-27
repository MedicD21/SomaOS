import Link from 'next/link';
import { addDays, describeGaps, localDateOf, startOfLocalDay, type GroupCheck } from '@soma/schedule-engine';
import { Forbidden } from '@/components/forbidden';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { check, getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { loadPatterns } from '@/server/scheduling/load';
import { loadRoster, type RosterSeatView, type RosterUnitView } from '@/server/scheduling/roster';
import { evaluateStaffingDay, type StaffingDay } from '@/server/scheduling/staffing';
import { AssignForm, CancelForm, GenerateForm, type MemberOption } from './assign-form';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERATE_DAYS = 28;

const BADGE: Record<string, string> = {
  overtime: 'OT',
  trade: 'Trade',
  holdover: 'Holdover',
  callback: 'Callback',
  acting: 'Acting',
  training: 'Training',
  detail: 'Detail',
};

function isValidDate(d: string): boolean {
  return DATE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);
}

function longDate(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function Badge({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="ml-2 inline-block rounded border border-line px-1.5 py-0.5 text-xs font-semibold">
      {children}
    </span>
  );
}

function Staffing({ filled, total }: { filled: number; total: number }) {
  return (
    <p className={`text-sm font-semibold ${filled < total ? 'text-danger' : ''}`}>
      Staffing <span data-testid="staffing">{`${filled}/${total}`}</span>
    </p>
  );
}

export default async function RosterPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('scheduling')) return <Forbidden reason="Scheduling is not enabled for this department." />;
  if (!hasAny(ctx, 'scheduling.roster.view')) return <Forbidden reason="no active grant for scheduling.roster.view" />;

  const tz = ctx.tenant.timezone;
  const today = localDateOf(new Date(), tz);
  const date = sp.date && isValidDate(sp.date) ? sp.date : today;
  const unitId = sp.unit && UUID.test(sp.unit) ? sp.unit : null;

  const { roster, members, parents, shiftStart, shiftHours, staffing } = await withCtxDb(ctx, async (tx) => {
    const roster = await loadRoster(tx, date, unitId);
    const staffing = await evaluateStaffingDay(tx, date);
    const members = await tx<MemberOption[]>`
      select m.id, m.last_name || ', ' || m.first_name as name, r.label as rank
      from members m left join ranks r on r.id = m.rank_id
      where m.tenant_id = app.tenant_id() and m.status = 'active'
      order by m.last_name, m.first_name`;
    const parentPaths = [...new Set(roster.units.map((u) => u.path.split('.').slice(0, -1).join('.')).filter(Boolean))];
    const parents = parentPaths.length
      ? await tx<{ name: string; path: string }[]>`
          select name, path::text as path from org_units
          where tenant_id = app.tenant_id() and path::text = any (${parentPaths}::text[])`
      : [];
    const dayEnd = startOfLocalDay(addDays(date, 1), tz).getTime();
    const pattern = (await loadPatterns(tx)).filter((p) => p.effectiveFrom.getTime() < dayEnd).at(-1)?.payload;
    return { roster, members: [...members], parents: [...parents], shiftStart: pattern?.shiftStart ?? '07:00', shiftHours: pattern?.shiftHours ?? 24, staffing };
  });

  const units = roster.units.filter((u) => check(ctx, 'scheduling.roster.view', { orgUnitPath: u.path }).allowed);
  const groups = new Map<string, { name: string; units: RosterUnitView[] }>();
  for (const u of units) {
    const parentPath = u.path.split('.').slice(0, -1).join('.');
    const name = parents.find((p) => p.path === parentPath)?.name ?? 'Units';
    const g = groups.get(parentPath) ?? { name, units: [] };
    g.units.push(u);
    groups.set(parentPath, g);
  }
  const canGenerate = check(ctx, 'scheduling.config.manage').allowed;
  const q = (d: string) => `/roster?date=${d}${unitId ? `&unit=${unitId}` : ''}`;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">Roster — {longDate(date)}</h1>
        <div className="flex flex-wrap items-end gap-3">
          <Link href={q(addDays(date, -1))} className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-semibold">
            Previous day
          </Link>
          <Link href={q(addDays(date, 1))} className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-semibold">
            Next day
          </Link>
          {date !== today && (
            <Link href={q(today)} className="inline-flex min-h-11 items-center px-2 text-sm underline">
              Today
            </Link>
          )}
          <form method="get" action="/roster" aria-label="Choose date" className="flex flex-wrap items-end gap-2">
            {unitId && <input type="hidden" name="unit" value={unitId} />}
            <Field id="roster-date" label="Date">
              <Input id="roster-date" name="date" type="date" defaultValue={date} required />
            </Field>
            <Button type="submit" variant="secondary">Go</Button>
          </form>
          {unitId && (
            <Link href={`/roster?date=${date}`} className="inline-flex min-h-11 items-center px-2 text-sm underline">
              Show all units
            </Link>
          )}
        </div>
      </div>

      {staffing && <StaffingBanner staffing={staffing} date={date} canMandate={hasAny(ctx, 'scheduling.mandate.manage')} />}

      {groups.size === 0 && (
        <Card>
          <p>No seats are set up{unitId ? ' for this unit' : ''} yet.</p>
        </Card>
      )}

      {[...groups.entries()].map(([path, g]) => {
        const filled = g.units.reduce((n, u) => n + u.requiredFilled, 0);
        const total = g.units.reduce((n, u) => n + u.requiredTotal, 0);
        const headingId = `station-${path.replace(/\W/g, '-')}`;
        return (
          <section key={path} aria-labelledby={headingId} className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={headingId} className="text-xl font-semibold">{g.name}</h2>
              <Staffing filled={filled} total={total} />
            </div>
            {g.units.map((u) => (
              <UnitTable
                key={u.orgUnitId}
                unit={u}
                unitChecks={staffing?.evaluation.units.find((x) => x.unitId === u.orgUnitId)?.checks ?? []}
                tz={staffing?.window.tz ?? tz}
                date={date}
                members={members}
                canEdit={check(ctx, 'scheduling.roster.edit', { orgUnitPath: u.path }).allowed}
                canOverride={check(ctx, 'scheduling.qualification.override', { orgUnitPath: u.path }).allowed}
                shiftStart={shiftStart}
                shiftHours={shiftHours}
              />
            ))}
          </section>
        );
      })}

      {canGenerate && (
        <Card title="Generate schedule">
          <p className="mb-4 text-sm text-muted">
            Creates regular shifts and Kelly days from standing seats. Existing and cancelled shifts are left as they are.
          </p>
          <GenerateForm from={today} to={addDays(today, GENERATE_DAYS)} />
        </Card>
      )}
    </div>
  );
}

function StaffingBanner({ staffing, date, canMandate }: { staffing: StaffingDay; date: string; canMandate: boolean }) {
  const { evaluation, transfers, window } = staffing;
  const clock = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: window.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  const deptShort = evaluation.department.some((d) => !d.met);
  const unitsShort = evaluation.units.filter((u) => u.violations.length > 0);
  return (
    <section aria-labelledby="staffing-heading" className={`rounded-lg border bg-surface p-4 shadow-sm sm:p-6 ${evaluation.met ? 'border-line' : 'border-danger'}`}>
      <h2 id="staffing-heading" className="mb-2 text-lg font-semibold">Minimum staffing</h2>
      <p className="mb-2 text-sm text-muted">
        Checked minute by minute from {clock(window.start)} to {clock(window.end)}; counts are the lowest on duty at any moment.
      </p>
      <ul className="space-y-1">
        {evaluation.department.map((d) => (
          <li key={d.group} className={`font-semibold ${d.met ? '' : 'text-danger'}`}>
            Department {d.label}: <span data-testid={`dept-${d.group}`}>{`${d.count}/${d.min}`}</span>
            {d.met ? ' — met' : ` — ${d.shortfall} short: ${describeGaps(d.gaps, window.tz)}`}
          </li>
        ))}
        {unitsShort.flatMap((u) => u.violations).map((v, i) => (
          <li key={i} className="text-danger">{v.message}</li>
        ))}
        {evaluation.met && <li className="text-sm text-muted">Every staffing rule is met.</li>}
      </ul>
      {transfers.length > 0 && (
        <div className="mt-3">
          <h3 className="font-semibold">Suggested temporary transfers</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="tt-suggestions">
            {transfers.map((t) => <li key={`${t.memberId}-${t.toUnitId}`}>{t.explain.message}.</li>)}
          </ul>
          <p className="mt-1 text-sm text-muted">Make a transfer by cancelling the member’s shift and filling the short unit’s seat.</p>
        </div>
      )}
      {deptShort && (
        <p className="mt-3 text-sm">
          Below the department minimum: use the{' '}
          {canMandate ? <Link href={`/mandate?date=${date}`} className="font-semibold underline">mandate list</Link> : 'mandate list'} for the next member up.
        </p>
      )}
    </section>
  );
}

function UnitTable({ unit, unitChecks, tz, date, members, canEdit, canOverride, shiftStart, shiftHours }: {
  unit: RosterUnitView;
  unitChecks: GroupCheck[];
  tz: string;
  date: string;
  members: MemberOption[];
  canEdit: boolean;
  canOverride: boolean;
  shiftStart: string;
  shiftHours: number;
}) {
  const headingId = `unit-${unit.orgUnitId}`;
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-line bg-surface p-4 shadow-sm sm:p-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headingId} className="text-lg font-semibold">{unit.name}</h3>
        <Staffing filled={unit.requiredFilled} total={unit.requiredTotal} />
      </div>
      {unitChecks.map((c) => (
        <p key={c.group} className={`mb-2 text-sm font-semibold ${c.met ? '' : 'text-danger'}`}>
          {c.label} <span data-testid={`unit-${c.group}`}>{`${c.count}/${c.min}`}</span>
          {c.met ? '' : ` — below the unit minimum: ${describeGaps(c.gaps, tz)}`}
        </p>
      ))}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead>
            <tr>
              <th scope="col" className="py-2 pr-3">Seat</th>
              <th scope="col" className="pr-3">Member</th>
              <th scope="col" className="pr-3">Issues</th>
              {canEdit && <th scope="col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {unit.seats.map((s) => (
              <SeatRow
                key={s.seat.id}
                view={s}
                unitName={unit.name}
                date={date}
                members={members}
                canEdit={canEdit}
                canOverride={canOverride}
                shiftStart={shiftStart}
                shiftHours={shiftHours}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SeatRow({ view, unitName, date, members, canEdit, canOverride, shiftStart, shiftHours }: {
  view: RosterSeatView;
  unitName: string;
  date: string;
  members: MemberOption[];
  canEdit: boolean;
  canOverride: boolean;
  shiftStart: string;
  shiftHours: number;
}) {
  const { seat, assignment: a, issues } = view;
  const label = `${unitName} ${seat.label}`;
  return (
    <tr className="border-t border-line align-top">
      <th scope="row" className="py-2 pr-3 font-medium">
        {seat.label}
        {!seat.required && <span className="block text-xs font-normal text-muted">Optional</span>}
      </th>
      <td className="py-2 pr-3">
        {a ? (
          <>
            {a.memberName}
            {BADGE[a.type] && <Badge>{BADGE[a.type]}</Badge>}
            {a.acting && a.type !== 'acting' && <Badge>Acting</Badge>}
            {a.overrideReason && <Badge title={a.overrideReason}>Override</Badge>}
          </>
        ) : seat.required ? (
          <span className="font-semibold text-danger">Vacant</span>
        ) : (
          <span className="text-muted">Open</span>
        )}
      </td>
      <td className="py-2 pr-3">
        {issues.length > 0 ? (
          <ul className="space-y-1 text-warning">
            {issues.map((i, n) => <li key={n}>{i.message}</li>)}
          </ul>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      {canEdit && (
        <td className="py-2">
          {a ? (
            <details>
              <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">Cancel</summary>
              <CancelForm assignmentId={a.id} label={label} />
            </details>
          ) : (
            <details>
              <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">Fill</summary>
              <AssignForm
                seatId={seat.id}
                date={date}
                label={label}
                members={members}
                canOverride={canOverride}
                defaultStart={shiftStart}
                defaultHours={shiftHours}
              />
            </details>
          )}
        </td>
      )}
    </tr>
  );
}
