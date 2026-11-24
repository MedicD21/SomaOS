import type postgres from 'postgres';

export type Handler = (payload: unknown) => Promise<void>;
export type Handlers = Record<string, Handler>;

export const MAX_ATTEMPTS = 5;
/** A job still `running` after this long is assumed to belong to a crashed worker. */
export const STALE_LOCK = '10 minutes';

type Job = { id: number; kind: string; payload: unknown; attempts: number };

async function claimNext(sql: postgres.Sql): Promise<Job | null> {
  const rows = await sql<Job[]>`
    update jobs set status = 'running', attempts = attempts + 1, locked_at = now()
    where id = (select id from jobs
                where (status = 'pending' and run_after <= now())
                   or (status = 'running' and locked_at < now() - ${STALE_LOCK}::interval)
                order by id for update skip locked limit 1)
    returning id, kind, payload, attempts`;
  return rows[0] ?? null;
}

/** Processes every due job once. Failures retry with exponential backoff, up to MAX_ATTEMPTS. */
export async function runOnce(sql: postgres.Sql, handlers: Handlers): Promise<number> {
  let processed = 0;
  for (let job = await claimNext(sql); job; job = await claimNext(sql)) {
    processed++;
    const handler = handlers[job.kind];
    try {
      if (!handler) {
        await sql`update jobs set status = 'failed', last_error = ${`no handler for job kind "${job.kind}"`}, finished_at = now() where id = ${job.id}`;
        continue;
      }
      await handler(job.payload);
      await sql`update jobs set status = 'done', last_error = null, finished_at = now() where id = ${job.id}`;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (job.attempts >= MAX_ATTEMPTS) {
        await sql`update jobs set status = 'failed', last_error = ${message}, finished_at = now() where id = ${job.id}`;
      } else {
        const delaySeconds = 30 * 2 ** (job.attempts - 1);
        await sql`update jobs set status = 'pending', last_error = ${message},
                  run_after = now() + make_interval(secs => ${delaySeconds}) where id = ${job.id}`;
      }
    }
  }
  return processed;
}
