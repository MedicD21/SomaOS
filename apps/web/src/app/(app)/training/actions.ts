'use server';
import { localToInstant } from '@soma/schedule-engine';
import { trainingAttendanceSchema, trainingCancelSchema, trainingSessionSchema } from '@soma/validators';
import { z } from 'zod';
import type { ActionResult } from '@/server/actions';
import { ActionError, runScoped, zodFieldErrors } from '@/server/actions';
import { loadAwardCandidates } from '@/server/training/load';

const MANAGE = ['training.session.manage'] as const;
const MARK = ['training.session.manage', 'training.attendance.mark', 'training.attendance.manage'] as const;
const uuid = z.uuid();

/** Creates a session as a draft (or publishes it straight away). Times are entered in the unit's local time zone. */
export async function createSession(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const audience = [
    ...form.getAll('audRank').map((v) => ({ kind: 'rank', refId: String(v) })),
    ...form.getAll('audRole').map((v) => ({ kind: 'role', refId: String(v) })),
    ...form.getAll('audUnit').map((v) => ({ kind: 'org_unit', refId: String(v) })),
  ];
  const parsed = trainingSessionSchema.safeParse({
    courseId: form.get('courseId'), title: form.get('title'), date: form.get('date'), startTime: form.get('startTime'),
    durationHours: form.get('durationHours'), orgUnitId: form.get('orgUnitId'), location: form.get('location'),
    instructorId: form.get('instructorId'), capacity: form.get('capacity'), assignedOnly: form.get('assignedOnly'), notes: form.get('notes'), audience,
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  const publish = form.get('publish') === 'on';
  return runScoped([...MANAGE], async (tx, ctx) => {
    const [z0] = await tx<{ tz: string }[]>`
      select coalesce(ou.timezone, t.timezone) as tz from tenants t left join org_units ou on ou.id = ${v.orgUnitId}::uuid where t.id = app.tenant_id()`;
    const tz = z0?.tz ?? ctx.tenant.timezone;
    const starts = localToInstant(v.date, v.startTime, tz);
    const ends = new Date(starts.getTime() + v.durationHours * 3_600_000);
    const [row] = await tx<{ id: string }[]>`
      select app.create_training_session(${v.courseId}, ${v.title}, ${starts.toISOString()}, ${ends.toISOString()}, ${v.orgUnitId}, ${v.location},
        ${v.instructorId}, ${v.capacity}, ${v.assignedOnly}, ${v.durationHours}, ${v.notes},
        ${tx.json(v.audience.map((a) => ({ kind: a.kind, ref_id: a.refId })) as never)}) as id`;
    if (!publish) return `Saved "${v.title}" as a draft.`;
    const [n] = await tx<{ n: number }[]>`select app.publish_training_session(${row!.id}) as n`;
    return `Published "${v.title}"${n!.n > 0 ? `; ${n!.n} required member${n!.n === 1 ? ' was' : 's were'} enrolled and notified` : ''}.`;
  });
}

export async function publishSession(sessionId: string): Promise<ActionResult> {
  return runScoped([...MANAGE], async (tx) => {
    const [n] = await tx<{ n: number }[]>`select app.publish_training_session(${uuid.parse(sessionId)}) as n`;
    return `Published; ${n!.n} required member${n!.n === 1 ? ' was' : 's were'} enrolled and notified.`;
  });
}

export async function refreshRequired(sessionId: string): Promise<ActionResult> {
  return runScoped([...MANAGE], async (tx) => {
    const [n] = await tx<{ n: number }[]>`select app.refresh_training_required(${uuid.parse(sessionId)}) as n`;
    return n!.n === 0 ? 'Nobody new matches the required list.' : `Added ${n!.n} member${n!.n === 1 ? '' : 's'} to the required list.`;
  });
}

export async function signUp(sessionId: string): Promise<ActionResult> {
  return runScoped(['training.session.view'], async (tx) => {
    const [r] = await tx<{ s: string }[]>`select app.sign_up_training(${uuid.parse(sessionId)}) as s`;
    return r!.s === 'waitlisted' ? 'The class is full: you are on the waitlist.' : 'You are signed up.';
  });
}

export async function withdraw(sessionId: string): Promise<ActionResult> {
  return runScoped(['training.session.view'], async (tx) => {
    await tx`select app.withdraw_training(${uuid.parse(sessionId)})`;
    return 'You are no longer signed up.';
  });
}

export async function addAttendee(sessionId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const member = uuid.safeParse(form.get('memberId'));
  if (!member.success) return { ok: false, message: 'Choose a member.', fieldErrors: { memberId: 'Choose a member' } };
  return runScoped([...MANAGE], async (tx) => {
    await tx`select app.add_training_attendee(${uuid.parse(sessionId)}, ${member.data})`;
    return 'Added.';
  });
}

export async function markAttendance(enrollmentId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = trainingAttendanceSchema.safeParse({ enrollmentId, status: form.get('status'), hours: form.get('hours'), note: form.get('note') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped([...MARK], async (tx) => {
    await tx`select app.mark_training_attendance(${v.enrollmentId}, ${v.status}, ${v.hours}, ${v.note})`;
    return 'Saved.';
  });
}

/** Marks everyone enrolled who has no attendance yet as present for the full session. */
export async function markAllPresent(sessionId: string): Promise<ActionResult> {
  return runScoped([...MARK], async (tx) => {
    const pending = await tx<{ id: string }[]>`
      select e.id from training_enrollments e
      where e.session_id = ${uuid.parse(sessionId)} and e.status = 'enrolled' and e.member_id is distinct from app.my_member_id()
        and not exists (select 1 from training_attendance a where a.enrollment_id = e.id)`;
    let done = 0;
    for (const e of pending) {
      await tx`select app.mark_training_attendance(${e.id}, 'attended', null, null)`;
      done++;
    }
    return done === 0 ? 'Everyone already has attendance recorded.' : `Marked ${done} present. Adjust anyone who was absent or left early.`;
  });
}

/** Marks the session done and awards the course credential, with expiry computed here from the credential's validity rule. */
export async function completeSession(sessionId: string): Promise<ActionResult> {
  return runScoped([...MANAGE], async (tx, ctx) => {
    const id = uuid.parse(sessionId);
    const { candidates } = await loadAwardCandidates(tx, id, ctx.tenant.timezone);
    const awards = candidates.map((c) => ({ member_id: c.memberId, issued_on: c.issuedOn, expires_on: c.expiresOn }));
    const [n] = await tx<{ n: number }[]>`select app.complete_training_session(${id}, ${tx.json(awards as never)}) as n`;
    return n!.n > 0 ? `Session completed. ${n!.n} credential${n!.n === 1 ? ' was' : 's were'} granted or renewed.` : 'Session completed.';
  });
}

export async function cancelSession(sessionId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = trainingCancelSchema.safeParse({ id: sessionId, reason: form.get('reason') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  return runScoped([...MANAGE], async (tx) => {
    await tx`select app.cancel_training_session(${parsed.data.id}, ${parsed.data.reason})`;
    return 'Session cancelled and everyone notified.';
  });
}

/** Puts enrolled members on the roster as training assignments; anyone already working is skipped and told why. */
export async function scheduleOnRoster(sessionId: string): Promise<ActionResult> {
  return runScoped([...MANAGE], async (tx) => {
    const id = uuid.parse(sessionId);
    const members = await tx<{ id: string }[]>`select member_id as id from training_enrollments where session_id = ${id} and status = 'enrolled'`;
    if (members.length === 0) throw new ActionError('Nobody is enrolled yet.');
    const [r] = await tx<{ r: { created: string[]; skipped: { member_id: string; reason: string }[] } }[]>`
      select app.schedule_training_assignments(${id}, ${members.map((m) => m.id)}::uuid[]) as r`;
    const { created, skipped } = r!.r;
    if (skipped.length === 0) return `Put ${created.length} on the roster.`;
    const names = await tx<{ id: string; name: string }[]>`select id, last_name || ', ' || first_name as name from members where id = any (${skipped.map((s) => s.member_id)}::uuid[])`;
    const label = new Map(names.map((n) => [n.id, n.name]));
    return `Put ${created.length} on the roster. Skipped: ${skipped.map((s) => `${label.get(s.member_id) ?? 'a member'} (${s.reason.toLowerCase()})`).join('; ')}.`;
  });
}
