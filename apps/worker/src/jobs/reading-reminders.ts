import type postgres from 'postgres';
import { nextScanTime } from './credential-expiry-scan';

export const READING_REMINDER_KIND = 'reading-reminders';

/** Inserts a pending reading-reminder job at `runAfter` unless one is already pending. */
export async function ensureReadingReminderJob(sql: postgres.Sql, runAfter: Date): Promise<void> {
  await sql`insert into jobs (kind, payload, run_after)
            select ${READING_REMINDER_KIND}, '{}'::jsonb, ${runAfter}
            where not exists (select 1 from jobs where kind = ${READING_REMINDER_KIND} and status = 'pending')`;
}

/** Sends today's required-reading reminders (the database logs each one, so a rerun sends nothing new) and reschedules. */
export async function sendReadingReminders(sql: postgres.Sql, now: Date): Promise<{ sent: number }> {
  const [r] = await sql<{ n: number }[]>`select app.send_reading_reminders() as n`;
  await ensureReadingReminderJob(sql, nextScanTime(now));
  return { sent: r?.n ?? 0 };
}
