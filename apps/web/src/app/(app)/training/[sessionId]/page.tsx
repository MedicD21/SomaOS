import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { SESSION_STATUS_LABEL as STATUS_LABEL, sessionWhen } from '@/server/training/format';
import { loadAwardCandidates, loadRoster, loadSession } from '@/server/training/load';
import {
  AddAttendeeForm, AttendanceForm, CancelForm, CompleteButton, MarkAllButton, PublishButton, RefreshButton, RosterButton, SignUpButton, WithdrawButton,
} from '../forms';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTENDANCE_LABEL: Record<string, string> = { attended: 'Attended', partial: 'Partial', absent: 'Absent', excused: 'Excused' };
const ENROLL_LABEL: Record<string, string> = { enrolled: 'Enrolled', waitlisted: 'Waitlisted', withdrawn: 'Withdrawn' };

export default async function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  if (!UUID.test(sessionId)) notFound();
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('training')) return <Forbidden reason="training is not enabled for this department" />;
  if (!hasAny(ctx, 'training.session.view') && !hasAny(ctx, 'training.session.manage')) return <Forbidden reason="no permission to view training" />;

  const data = await withCtxDb(ctx, async (tx) => {
    const session = await loadSession(tx, sessionId);
    if (!session) return null;
    const roster = await loadRoster(tx, sessionId);
    const awards = await loadAwardCandidates(tx, sessionId, session.tz);
    const members = await tx<{ id: string; label: string }[]>`
      select id, last_name || ', ' || first_name as label from members where status <> 'separated' order by last_name, first_name`;
    return { session, roster: [...roster], awards, members: [...members] };
  });
  if (!data) notFound();
  const { session: s, roster, awards, members } = data;

  const canManage = hasAny(ctx, 'training.session.manage');
  const canMark = canManage || hasAny(ctx, 'training.attendance.mark') || hasAny(ctx, 'training.attendance.manage') || s.instructorId !== null;
  const started = s.startsAt.getTime() <= Date.now();
  const open = s.status === 'draft' || s.status === 'scheduled';
  const mine = s.myStatus === 'enrolled' || s.myStatus === 'waitlisted';
  const enrolled = roster.filter((r) => r.status === 'enrolled');
  const waitlisted = roster.filter((r) => r.status === 'waitlisted');

  return (
    <div className="space-y-6">
      <p><Link className="underline" href="/training">← Training</Link></p>
      <h1 className="text-2xl font-bold">{s.title}</h1>
      <Card>
        <dl className="grid gap-2 sm:grid-cols-2">
          <div><dt className="text-sm text-muted">When</dt><dd>{sessionWhen(s)}</dd></div>
          <div><dt className="text-sm text-muted">Status</dt><dd>{STATUS_LABEL[s.status]}{s.cancelledReason ? ` — ${s.cancelledReason}` : ''}</dd></div>
          <div><dt className="text-sm text-muted">Course</dt><dd>{s.courseLabel} · {s.categoryLabel} · {s.durationHours} h</dd></div>
          <div><dt className="text-sm text-muted">Where</dt><dd>{[s.unitName ?? 'Department-wide', s.location].filter(Boolean).join(' · ')}</dd></div>
          <div><dt className="text-sm text-muted">Instructor</dt><dd>{s.instructorName ?? 'None listed'}</dd></div>
          <div><dt className="text-sm text-muted">Capacity</dt><dd>{s.capacity ?? 'No limit'}{s.assignedOnly ? ' · By assignment only' : ''}</dd></div>
          {s.credentialLabel && <div><dt className="text-sm text-muted">Earns</dt><dd>{s.credentialLabel}</dd></div>}
        </dl>
        {s.notes && <p className="mt-3 text-sm text-muted">{s.notes}</p>}
        {s.status === 'scheduled' && !started && (
          <div className="mt-4">
            {mine ? <><p className="mb-2 font-medium">{s.myStatus === 'waitlisted' ? 'You are on the waitlist.' : 'You are enrolled.'}</p><WithdrawButton id={s.id} title={s.title} /></>
              : !s.assignedOnly ? <SignUpButton id={s.id} title={s.title} /> : <p className="text-sm text-muted">This session is by assignment only.</p>}
          </div>
        )}
      </Card>

      {canManage && open && (
        <Card title="Run this session">
          <div className="space-y-4">
            {s.status === 'draft' && <PublishButton id={s.id} />}
            {s.status === 'scheduled' && <RefreshButton id={s.id} />}
            {s.status === 'scheduled' && <RosterButton id={s.id} />}
            <AddAttendeeForm id={s.id} members={members} />
            <CancelForm id={s.id} />
          </div>
        </Card>
      )}

      {(canManage || canMark || roster.length > 0) && (
        <section aria-labelledby="roster">
          <h2 id="roster" className="mb-3 text-lg font-semibold">Who is enrolled ({enrolled.length}{waitlisted.length ? `, ${waitlisted.length} waitlisted` : ''})</h2>
          {roster.length === 0 ? <p>Nobody is enrolled yet.</p> : (
            <>
              {canMark && started && s.status !== 'cancelled' && s.status !== 'draft' && <div className="mb-3"><MarkAllButton id={s.id} /></div>}
              <ul aria-label="Enrolled members" className="space-y-3">
                {roster.map((r) => (
                  <li key={r.enrollmentId} className="rounded-lg border border-line bg-surface p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold">{r.name}</span>
                      <span className="text-sm">{ENROLL_LABEL[r.status]}{r.source === 'required' ? ' · Required' : ''}</span>
                    </div>
                    {r.attendance && (
                      <p className="text-sm">{ATTENDANCE_LABEL[r.attendance]}{r.attendance === 'attended' || r.attendance === 'partial' ? ` · ${r.hours} h` : ''}{r.note ? ` · ${r.note}` : ''}</p>
                    )}
                    {r.awardKind && <p className="text-sm font-medium">Credential {r.awardKind}</p>}
                    {r.changedAfterAward && <p className="text-sm text-danger">Attendance changed after the credential was awarded. Review it.</p>}
                    {canMark && started && r.status === 'enrolled' && s.status !== 'cancelled' && s.status !== 'draft' && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-sm underline">Mark attendance</summary>
                        <AttendanceForm enrollmentId={r.enrollmentId} name={r.name} status={r.attendance} hours={r.hours} note={r.note} />
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {canManage && started && (s.status === 'scheduled' || s.status === 'completed') && (
        <Card title="Complete the session">
          {awards.credentialLabel === null ? (
            <p className="mb-3">This course does not grant a credential. Completing it marks the session done.</p>
          ) : awards.candidates.length === 0 ? (
            <p className="mb-3">No one new qualifies for {awards.credentialLabel} yet. Mark attendance first.</p>
          ) : (
            <div className="mb-3">
              <p>These members will receive <strong>{awards.credentialLabel}</strong>:</p>
              <ul aria-label="Credentials to award" className="mt-2 list-disc pl-5 text-sm">
                {awards.candidates.map((c) => <li key={c.memberId}>{c.name}: issued {c.issuedOn}, {c.expiresOn ? `expires ${c.expiresOn}` : 'does not expire'}</li>)}
              </ul>
            </div>
          )}
          {s.status === 'scheduled' || awards.candidates.length > 0 ? <CompleteButton id={s.id} /> : <p className="text-sm text-muted">This session is complete.</p>}
        </Card>
      )}
    </div>
  );
}
