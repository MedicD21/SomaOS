import type postgres from 'postgres';
import { daysBetween, dueWarning, localDateOf } from '@soma/schedule-engine';

export const SCAN_KIND = 'credential-expiry-scan';

type Row = {
  id: string;
  member_id: string;
  expires_on: string;
  last_warned_days: number | null;
  label: string;
  warn_days: number[];
  timezone: string;
};

const DAY_MS = 86_400_000;

/** Next 06:00 UTC strictly after `now`. */
export function nextScanTime(now: Date): Date {
  const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 6);
  return new Date(t > now.getTime() ? t : t + DAY_MS);
}

function titleFor(label: string, daysUntil: number): string {
  if (daysUntil < 0) return `${label} has expired`;
  if (daysUntil === 0) return `${label} expires today`;
  return `${label} expires in ${daysUntil} ${daysUntil === 1 ? 'day' : 'days'}`;
}

/** Inserts a pending scan job at `runAfter` unless one is already pending. */
export async function ensureScanJob(sql: postgres.Sql, runAfter: Date): Promise<void> {
  await sql`insert into jobs (kind, payload, run_after)
            select ${SCAN_KIND}, '{}'::jsonb, ${runAfter}
            where not exists (select 1 from jobs where kind = ${SCAN_KIND} and status = 'pending')`;
}

export async function credentialExpiryScan(sql: postgres.Sql, now: Date): Promise<{ warned: number }> {
  const rows = await sql<Row[]>`
    select c.id, c.member_id, c.expires_on::text as expires_on, c.last_warned_days,
           t.label, t.warn_days, tn.timezone
    from member_credentials c
    join credential_types t on t.tenant_id = c.tenant_id and t.id = c.type_id and t.status = 'active'
    join members m on m.tenant_id = c.tenant_id and m.id = c.member_id and m.status <> 'separated'
    join tenants tn on tn.id = c.tenant_id and tn.status = 'active'
    where c.status = 'active' and c.expires_on is not null`;

  // Enqueue the next run first so a failure below can never break the daily chain
  // (the running job is not 'pending', so this does not collide with itself).
  await ensureScanJob(sql, nextScanTime(now));

  let warned = 0;
  const failures: string[] = [];
  for (const r of rows) {
    try {
      const today = localDateOf(now, r.timezone);
      const due = dueWarning(r.expires_on, today, r.warn_days, r.last_warned_days);
      if (due === null) continue;
      const title = titleFor(r.label, daysBetween(today, r.expires_on));
      const sent = await sql.begin(async (tx) => {
        // Re-check under a row lock so concurrent scans cannot double-notify or warn on stale data.
        const [cur] = await tx<{ last_warned_days: number | null }[]>`
          select last_warned_days from member_credentials
          where id = ${r.id} and status = 'active' and expires_on = ${r.expires_on}::date for update`;
        if (!cur || cur.last_warned_days !== r.last_warned_days) return false;
        await tx`select app.notify(${r.member_id}, 'credential.expiring', ${title}, ${`Expiry date: ${r.expires_on}`}, ${`/admin/members/${r.member_id}`})`;
        await tx`update member_credentials set last_warned_days = ${due} where id = ${r.id}`;
        return true;
      });
      if (sent) warned++;
    } catch (e) {
      failures.push(`${r.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`credential expiry scan: ${failures.length} of ${rows.length} credential(s) failed (${warned} warned): ${failures.join('; ')}`);
  }
  return { warned };
}
