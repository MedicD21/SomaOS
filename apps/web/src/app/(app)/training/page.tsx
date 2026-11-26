import Link from 'next/link';
import { localDateOf } from '@soma/schedule-engine';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { SESSION_STATUS_LABEL as STATUS_LABEL, sessionWhen as when } from '@/server/training/format';
import { loadMyHours, loadMySessions, loadUpcomingSessions } from '@/server/training/load';
import { CreateSessionForm, SignUpButton, WithdrawButton } from './forms';

const MINE_LABEL: Record<string, string> = { enrolled: 'You are enrolled', waitlisted: 'You are on the waitlist' };

export default async function TrainingPage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('training')) return <Forbidden reason="training is not enabled for this department" />;
  const canManage = hasAny(ctx, 'training.session.manage');
  if (!hasAny(ctx, 'training.session.view') && !canManage) return <Forbidden reason="no permission to view training" />;

  const data = await withCtxDb(ctx, async (tx) => {
    const upcoming = await loadUpcomingSessions(tx);
    const mine = await loadMySessions(tx);
    const hours = await loadMyHours(tx, ctx.tenant.timezone);
    const form = canManage
      ? {
          courses: [...(await tx<{ id: string; label: string }[]>`select id, label from training_courses where archived_at is null order by label`)],
          units: [...(await tx<{ id: string; label: string }[]>`select id, name as label from org_units order by path`)],
          members: [...(await tx<{ id: string; label: string }[]>`select id, last_name || ', ' || first_name as label from members where status <> 'separated' order by last_name, first_name`)],
          ranks: [...(await tx<{ id: string; label: string }[]>`select id, label from ranks order by sort`)],
          roles: [...(await tx<{ id: string; label: string }[]>`select id, label from roles order by label`)],
        }
      : null;
    return { upcoming: [...upcoming], mine: [...mine], hours: [...hours], form };
  });
  const now = Date.now();
  const today = localDateOf(new Date(), ctx.tenant.timezone);
  const myUpcoming = data.mine.filter((s) => s.endsAt.getTime() > now && s.status !== 'cancelled');
  const myPast = data.mine.filter((s) => s.endsAt.getTime() <= now || s.status === 'cancelled').slice(0, 10);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Training</h1>
      <p className="text-muted">Classes and drills you can sign up for, what you are enrolled in, and the hours you have earned this year.</p>

      <section aria-labelledby="my-hours">
        <h2 id="my-hours" className="mb-3 text-lg font-semibold">My hours this year</h2>
        {data.hours.length === 0 ? <p>No hours recorded yet this year.</p> : (
          <ul aria-label="My hours" className="grid gap-3 sm:grid-cols-2">
            {data.hours.map((h) => (
              <li key={h.categoryId} className="flex items-baseline justify-between rounded-lg border border-line bg-surface p-4">
                <span className="font-medium">{h.categoryLabel}</span><span>{Math.round(h.hours * 100) / 100} h</span>
              </li>
            ))}
          </ul>
        )}
        {hasAny(ctx, 'training.compliance.view') && <p className="mt-3"><Link className="underline" href="/training/compliance">See who is due or overdue</Link></p>}
      </section>

      <section aria-labelledby="mine">
        <h2 id="mine" className="mb-3 text-lg font-semibold">My classes</h2>
        {myUpcoming.length === 0 ? <p>You are not enrolled in any upcoming class.</p> : (
          <ul aria-label="My classes" className="space-y-3">
            {myUpcoming.map((s) => (
              <li key={s.id} className="rounded-lg border border-line bg-surface p-4">
                <Link className="font-semibold underline" href={`/training/${s.id}`}>{s.title}</Link>
                <p className="text-sm">{when(s)}{s.unitName ? ` · ${s.unitName}` : ''}{s.location ? ` · ${s.location}` : ''}</p>
                <p className="text-sm text-muted">{s.myStatus ? MINE_LABEL[s.myStatus] : ''}</p>
              </li>
            ))}
          </ul>
        )}
        {myPast.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm underline">Past classes</summary>
            <ul aria-label="Past classes" className="mt-2 space-y-2 text-sm">
              {myPast.map((s) => <li key={s.id}><Link className="underline" href={`/training/${s.id}`}>{s.title}</Link> — {when(s)} ({STATUS_LABEL[s.status]})</li>)}
            </ul>
          </details>
        )}
      </section>

      <section aria-labelledby="upcoming">
        <h2 id="upcoming" className="mb-3 text-lg font-semibold">Upcoming sessions</h2>
        {data.upcoming.length === 0 ? <p>No sessions are scheduled.</p> : (
          <ul aria-label="Upcoming sessions" className="space-y-3">
            {data.upcoming.map((s) => {
              const future = s.startsAt.getTime() > now;
              return (
                <li key={s.id} className="rounded-lg border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link className="font-semibold underline" href={`/training/${s.id}`}>{s.title}</Link>
                    <span className="text-sm">{STATUS_LABEL[s.status]}</span>
                  </div>
                  <p className="text-sm">{s.courseLabel} · {s.categoryLabel} · {s.durationHours} h</p>
                  <p className="text-sm">{when(s)}{s.unitName ? ` · ${s.unitName}` : ''}{s.location ? ` · ${s.location}` : ''}</p>
                  <p className="text-sm text-muted">
                    {s.instructorName ? `Instructor: ${s.instructorName}` : 'No instructor listed'}{s.capacity ? ` · Capacity ${s.capacity}` : ''}{s.assignedOnly ? ' · By assignment' : ''}
                    {s.credentialLabel ? ` · Earns ${s.credentialLabel}` : ''}
                  </p>
                  {s.myStatus && s.myStatus !== 'withdrawn' && <p className="text-sm font-medium">{MINE_LABEL[s.myStatus]}</p>}
                  {s.status === 'scheduled' && future && (
                    <div className="mt-2">
                      {s.myStatus === 'enrolled' || s.myStatus === 'waitlisted' ? (
                        <WithdrawButton id={s.id} title={s.title} />
                      ) : !s.assignedOnly ? (
                        <SignUpButton id={s.id} title={s.title} />
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {data.form && (
        <Card title="Schedule a session">
          {data.form.courses.length === 0
            ? <p>Add a course under Admin → Training first.</p>
            : <CreateSessionForm {...data.form} today={today} />}
        </Card>
      )}
    </div>
  );
}
