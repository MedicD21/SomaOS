import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runOnce, type Handlers } from '../../src/runner';

const sql = postgres(process.env.SOMA_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { onnotice: () => undefined });
afterAll(() => sql.end());
beforeEach(async () => {
  await sql`delete from jobs`;
});

describe('runOnce', () => {
  it('runs pending jobs and marks them done', async () => {
    await sql`insert into jobs (kind, payload) values ('echo', '{"n":1}'), ('echo', '{"n":2}')`;
    const seen: unknown[] = [];
    const handlers: Handlers = { echo: async (p) => void seen.push(p) };
    expect(await runOnce(sql, handlers)).toBe(2);
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
    const rows = await sql`select status, attempts from jobs order by id`;
    expect(rows.map((r) => r.status)).toEqual(['done', 'done']);
  });

  it('retries failures with backoff and fails after 5 attempts', async () => {
    await sql`insert into jobs (kind, payload) values ('boom', '{}')`;
    const handlers: Handlers = { boom: async () => { throw new Error('smtp down'); } };
    await runOnce(sql, handlers);
    let [job] = await sql`select status, attempts, last_error, run_after > now() as delayed from jobs`;
    expect(job).toMatchObject({ status: 'pending', attempts: 1, last_error: 'smtp down', delayed: true });
    await sql`update jobs set attempts = 4, run_after = now()`;
    await runOnce(sql, handlers);
    [job] = await sql`select status, attempts from jobs`;
    expect(job).toMatchObject({ status: 'failed', attempts: 5 });
  });

  it('reclaims jobs stuck in running after a crash', async () => {
    await sql`insert into jobs (kind, payload, status, locked_at) values
              ('echo', '{"n":"stale"}', 'running', now() - interval '11 minutes'),
              ('echo', '{"n":"fresh"}', 'running', now() - interval '1 minute')`;
    const seen: unknown[] = [];
    expect(await runOnce(sql, { echo: async (p) => void seen.push(p) })).toBe(1);
    expect(seen).toEqual([{ n: 'stale' }]);
  });

  it('fails jobs with no handler instead of looping', async () => {
    await sql`insert into jobs (kind, payload) values ('mystery', '{}')`;
    await runOnce(sql, {});
    const [job] = await sql`select status, last_error from jobs`;
    expect(job).toMatchObject({ status: 'failed', last_error: 'no handler for job kind "mystery"' });
  });
});
