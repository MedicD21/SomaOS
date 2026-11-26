import 'server-only';
import type { Tx } from '@/server/db';

export type MyReading = {
  readingId: string;
  title: string;
  number: string | null;
  versionLabel: string;
  dueOn: string | null;
  overdue: boolean;
  statement: string;
  requireTypedName: boolean;
  acknowledgedAt: Date | null;
  closed: boolean;
  attachmentId: string | null;
};

/** The caller's own required reading, newest first; the link goes to the version currently in force. */
export async function loadMyReadings(tx: Tx): Promise<MyReading[]> {
  const rows = await tx<MyReading[]>`
    select r.id as "readingId", d.title, d.number, coalesce(av.label, cv.label, rv.label) as "versionLabel", r.due_on::text as "dueOn",
           (k.id is null and r.closed_at is null and r.due_on < app.today()) as overdue,
           r.statement, r.require_typed_name as "requireTypedName", k.acknowledged_at as "acknowledgedAt", r.closed_at is not null as closed,
           cv.attachment_id as "attachmentId"
    from reading_assignees a
    join required_readings r on r.id = a.reading_id
    join documents d on d.id = r.document_id
    left join document_versions cv on cv.document_id = r.document_id and cv.status = 'published'
    join document_versions rv on rv.id = r.version_id
    left join acknowledgements k on k.reading_id = r.id and k.member_id = a.member_id
    left join document_versions av on av.id = k.version_id
    where a.member_id = app.my_member_id()
    order by (k.id is null and r.closed_at is null) desc, r.due_on nulls last, d.title`;
  return [...rows];
}

export type ReadingReport = {
  readingId: string;
  title: string;
  versionLabel: string;
  dueOn: string | null;
  closed: boolean;
  assigned: number;
  acknowledged: number;
  overdue: number;
  waiting: string[];
};

/** Who has and has not read each open reading, limited by the database to the members the caller may see. */
export async function loadReadingReport(tx: Tx): Promise<ReadingReport[]> {
  const rows = await tx<Omit<ReadingReport, 'waiting'>[]>`
    select r.id as "readingId", d.title, v.label as "versionLabel", r.due_on::text as "dueOn", r.closed_at is not null as closed,
           count(s.member_id)::int as assigned, count(s.acknowledged_at)::int as acknowledged,
           count(*) filter (where s.overdue)::int as overdue
    from required_readings r
    join documents d on d.id = r.document_id
    join document_versions v on v.id = r.version_id
    left join reading_status s on s.reading_id = r.id
    where r.closed_at is null
    group by r.id, d.title, v.label
    order by r.due_on nulls last, d.title`;
  const out: ReadingReport[] = [];
  for (const r of rows) {
    const waiting = await tx<{ name: string }[]>`
      select m.last_name || ', ' || m.first_name as name from reading_status s join members m on m.id = s.member_id
      where s.reading_id = ${r.readingId} and s.acknowledged_at is null order by m.last_name, m.first_name`;
    out.push({ ...r, waiting: waiting.map((w) => w.name) });
  }
  return out;
}
