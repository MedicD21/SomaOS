import Link from 'next/link';
import { addDays, localDateOf, startOfLocalDay } from '@soma/schedule-engine';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { getRequestContext, withCtxDb } from '@/server/context';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

type Shift = {
  id: string;
  date: string;
  start: Date;
  end: Date;
  type: string;
  kelly: boolean;
  place: string;
  tz: string;
};

const TYPE_LABEL: Record<string, string> = {
  regular: 'Regular',
  overtime: 'Overtime',
  trade: 'Trade',
  holdover: 'Holdover',
  callback: 'Callback',
  acting: 'Acting',
  training: 'Training',
  detail: 'Detail',
  kelly: 'Kelly day',
};

function monthBounds(key: string): { first: string; next: string; prev: string; after: string } {
  const [y, m] = key.split('-').map(Number) as [number, number];
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    first: iso(new Date(Date.UTC(y, m - 1, 1))),
    next: iso(new Date(Date.UTC(y, m, 1))),
    prev: iso(new Date(Date.UTC(y, m - 2, 1))).slice(0, 7),
    after: iso(new Date(Date.UTC(y, m, 1))).slice(0, 7),
  };
}

function clock(d: Date, tz: string, withZone: boolean): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(withZone ? { timeZoneName: 'short' } : {}),
  }).format(d);
}

function hours(s: Shift): string {
  const h = Math.round(((s.end.getTime() - s.start.getTime()) / 3_600_000) * 100) / 100;
  return `${h} h`;
}

function ShiftBody({ s, tenantTz }: { s: Shift; tenantTz: string }) {
  const differs = s.tz !== tenantTz;
  return (
    <>
      <span className="block font-semibold">{s.kelly ? 'Kelly day' : s.place}</span>
      <span className="block">
        {clock(s.start, s.tz, false)}–{clock(s.end, s.tz, differs)} · {hours(s)}
      </span>
      {!s.kelly && <span className="block text-muted">{TYPE_LABEL[s.type] ?? s.type}</span>}
    </>
  );
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('scheduling')) return <Forbidden reason="Scheduling is not enabled for this department." />;

  const tenantTz = ctx.tenant.timezone;
  const key = sp.month && MONTH.test(sp.month) ? sp.month : localDateOf(new Date(), tenantTz).slice(0, 7);
  const { first, next, prev, after } = monthBounds(key);
  const title = new Date(`${first}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  let shifts: Shift[] = [];
  if (ctx.memberId) {
    // Window padded by a day each side; the exact month is decided by each shift's local start date below.
    const from = startOfLocalDay(addDays(first, -1), tenantTz);
    const to = startOfLocalDay(addDays(next, 1), tenantTz);
    const rows = await withCtxDb(ctx, (tx) =>
      tx<{ id: string; starts: Date; ends: Date; type: string; seat: string | null; unit: string | null; tz: string }[]>`
        select a.id, lower(a.during) as starts, upper(a.during) as ends, a.type,
               s.label as seat, ou.name as unit, coalesce(ou.timezone, t.timezone) as tz
        from shift_assignments a
        join tenants t on t.id = a.tenant_id
        left join seats s on s.id = a.seat_id
        left join org_units ou on ou.id = s.org_unit_id
        where a.member_id = app.my_member_id() and a.status = 'scheduled'
          and a.during && tstzrange(${from.toISOString()}, ${to.toISOString()})
        order by lower(a.during)`,
    );
    shifts = rows
      .map((r) => ({
        id: r.id,
        date: localDateOf(r.starts, r.tz),
        start: r.starts,
        end: r.ends,
        type: r.type,
        kelly: r.type === 'kelly',
        place: [r.unit, r.seat].filter(Boolean).join(' · ') || (TYPE_LABEL[r.type] ?? r.type),
        tz: r.tz,
      }))
      .filter((s) => s.date.startsWith(key));
  }

  const byDate = new Map<string, Shift[]>();
  for (const s of shifts) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);

  // Month grid: weeks start on Sunday.
  const firstDow = new Date(`${first}T00:00:00Z`).getUTCDay();
  const dayCount = Math.round((Date.parse(`${next}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000);
  const cells: (string | null)[] = [...Array<null>(firstDow).fill(null), ...Array.from({ length: dayCount }, (_, i) => addDays(first, i))];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const navLink = 'inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-semibold';
  const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">My schedule — {title}</h1>
        <div className="flex flex-wrap gap-3">
          <Link href={`/schedule?month=${prev}`} className={navLink}>Previous month</Link>
          <Link href={`/schedule?month=${after}`} className={navLink}>Next month</Link>
          <Link href="/schedule" className="inline-flex min-h-11 items-center px-2 text-sm underline">This month</Link>
        </div>
      </div>

      {!ctx.memberId && (
        <Card>
          <p>You do not have a member record in this department, so there is no schedule to show.</p>
        </Card>
      )}
      {ctx.memberId && shifts.length === 0 && (
        <Card>
          <p>No shifts scheduled for {title}.</p>
        </Card>
      )}

      {ctx.memberId && shifts.length > 0 && (
        <>
          <div className="hidden md:block">
            <table className="w-full table-fixed border-collapse text-sm">
              <caption className="pb-2 text-left font-semibold">My schedule, {title}</caption>
              <thead>
                <tr>
                  {weekdays.map((w) => (
                    <th key={w} scope="col" className="border border-line bg-surface p-2 text-left font-semibold">
                      {w}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week, wi) => (
                  <tr key={wi}>
                    {week.map((d, di) => (
                      <td key={di} className="h-24 border border-line p-2 align-top">
                        {d && (
                          <>
                            <span className="block text-xs text-muted">{Number(d.slice(8))}</span>
                            {(byDate.get(d) ?? []).map((s) => (
                              <div key={s.id} data-shift="" data-date={s.date} data-kelly={s.kelly ? '' : undefined} className="mt-1 rounded border border-line p-1">
                                <ShiftBody s={s} tenantTz={tenantTz} />
                              </div>
                            ))}
                          </>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul aria-label={`Shifts in ${title}`} className="space-y-3 md:hidden">
            {shifts.map((s) => (
              <li key={s.id} className="rounded-lg border border-line bg-surface p-4">
                <span className="block text-sm text-muted">{dayLabel(s.date)}</span>
                <ShiftBody s={s} tenantTz={tenantTz} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
