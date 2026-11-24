import { localDateOf } from '@soma/schedule-engine';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { AddTimeForm, VoidTimeForm } from './forms';

type Entry = { id: string; member: string; work_date: string; hours: number; type: string; reason: string; status: string; void_reason: string | null };

export default async function TimePage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('pay')) return <Forbidden reason="pay is not enabled for this department" />;
  if (!hasAny(ctx, 'scheduling.roster.edit') && !hasAny(ctx, 'pay.manage')) return <Forbidden reason="no permission to record time" />;

  const data = await withCtxDb(ctx, async (tx) => {
    // Only the members this caller may record time for, and the entries they may see (both enforced by the database).
    const members = await tx<{ id: string; label: string }[]>`
      select id, last_name || ', ' || first_name as label from members
      where status <> 'separated' and app.can_edit_time(id) order by last_name, first_name`;
    const entries = await tx<Entry[]>`
      select e.id, m.last_name || ', ' || m.first_name as member, e.work_date::text, e.hours::float8 as hours, e.type, e.reason, e.status, e.void_reason
      from time_entries e join members m on m.id = e.member_id
      where app.can_edit_time(e.member_id)
      order by e.work_date desc, e.created_at desc limit 50`;
    return { members: [...members], entries: [...entries] };
  });
  const today = localDateOf(new Date(), ctx.tenant.timezone);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Time</h1>
      <p className="text-muted">
        Record time worked that differs from the schedule, such as a holdover or callback. It is added to the pay period.
        Entries are never edited: if one is wrong, void it and record it again. You cannot record time for yourself, and
        periods payroll has closed are locked.
      </p>
      <Card title="Record time">
        {data.members.length === 0 ? <p>You do not cover any members.</p> : <AddTimeForm members={data.members} today={today} />}
      </Card>
      <section aria-labelledby="recent">
        <h2 id="recent" className="mb-3 text-lg font-semibold">Recent entries</h2>
        {data.entries.length === 0 ? (
          <p>No time recorded yet.</p>
        ) : (
          <ul aria-label="Time entries" className="space-y-3">
            {data.entries.map((e) => (
              <li key={e.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{e.member}</span>
                  <span>{e.work_date} · {Math.round(e.hours * 100) / 100} h · {e.type}</span>
                </div>
                <p className="text-sm text-muted">{e.reason}</p>
                {e.status === 'void' ? (
                  <p className="text-sm font-medium">Void — {e.void_reason}</p>
                ) : (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm underline">Void this entry</summary>
                    <VoidTimeForm id={e.id} label={`${e.member} ${e.work_date}`} />
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
