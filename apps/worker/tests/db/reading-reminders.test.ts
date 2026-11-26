import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { READING_REMINDER_KIND, sendReadingReminders } from '../../src/jobs/reading-reminders';

const sql = postgres(process.env.SOMA_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { onnotice: () => undefined });

afterAll(async () => {
  // Append-only tables block deleting the department; it is cleared by the next database reset.
  await sql.end();
});

describe('sendReadingReminders', () => {
  it('sends the assignment reminder once, then nothing the same day, and keeps exactly one job scheduled', async () => {
    const slug = `reading-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const [t] = await sql`insert into tenants (name, slug, timezone, department_type) values ('Reading Test', ${slug}, 'America/Chicago', 'career') returning id`;
    const tenant = t!.id as string;
    const [m] = await sql`insert into members (tenant_id, first_name, last_name, employment_type) values (${tenant}, 'Pat', 'Reader', 'career_full_time') returning id`;
    const [f] = await sql`insert into document_folders (tenant_id, name) values (${tenant}, 'F') returning id`;
    const [d] = await sql`insert into documents (tenant_id, folder_id, title, kind, requires_ack) values (${tenant}, ${f!.id}, 'Vehicle Fires', 'sog', true) returning id`;
    const vid = crypto.randomUUID();
    const [a] = await sql`insert into attachments (tenant_id, entity, entity_id, object_path, file_name, mime_type, size_bytes, sha256)
                          values (${tenant}, 'document_version', ${vid}, ${`${tenant}/document_version/${vid}/x.pdf`}, 'x.pdf', 'application/pdf', 1, 'a') returning id`;
    await sql`insert into document_versions (id, tenant_id, document_id, version_no, label, attachment_id, status, effective_from, published_at)
              values (${vid}, ${tenant}, ${d!.id}, 1, '1.0', ${a!.id}, 'published', current_date, now())`;
    const [r] = await sql`insert into required_readings (tenant_id, document_id, version_id, audience, due_on, statement)
                          values (${tenant}, ${d!.id}, ${vid}, '{"all": true}', current_date + 14, 'I have read and understand this.') returning id`;
    await sql`insert into reading_assignees (tenant_id, reading_id, member_id) values (${tenant}, ${r!.id}, ${m!.id})`;
    await sql`delete from jobs where kind = ${READING_REMINDER_KIND}`;

    const now = new Date('2026-04-15T12:00:00Z');
    const first = await sendReadingReminders(sql, now);
    expect(first.sent).toBeGreaterThanOrEqual(1);
    expect((await sql`select 1 from notifications where tenant_id = ${tenant} and member_id = ${m!.id} and kind = 'reading-reminder'`).length).toBe(1);
    expect((await sendReadingReminders(sql, now)).sent).toBe(0);
    const pending = await sql`select 1 from jobs where kind = ${READING_REMINDER_KIND} and status = 'pending'`;
    expect(pending.length).toBe(1);
  });
});
