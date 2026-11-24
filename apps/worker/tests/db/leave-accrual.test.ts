import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAccruals } from '../../src/jobs/leave-accrual';

const sql = postgres(process.env.SOMA_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { onnotice: () => undefined });
const tenants: string[] = [];

const policy = (over: object = {}) => ({
  period: { kind: 'monthly' },
  tiers: [{ fromYears: 0, earn: { method: 'per_period', hours: 8 } }],
  cap: null,
  waitingPeriodDays: 0,
  prorateFirstPeriod: true,
  fractionByEmploymentType: {},
  negativeAllowed: false,
  carryover: { max: null, resetOn: null },
  ...over,
});

async function setup(opts: { status?: 'approved' | 'draft'; payload?: object; from?: string } = {}) {
  const slug = `accrual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const [t] = await sql`insert into tenants (name, slug, timezone, department_type) values ('Accrual Test', ${slug}, 'America/Chicago', 'career') returning id`;
  tenants.push(t!.id);
  const [b] = await sql`insert into leave_banks (tenant_id, key, label) values (${t!.id}, 'vacation', 'Vacation') returning id`;
  await sql`insert into config_versions (tenant_id, kind, key, version, status, effective, payload)
            values (${t!.id}, 'leave.accrual', 'vacation', 1, ${opts.status ?? 'approved'},
                    tstzrange((${opts.from ?? '2026-01-01'}::date)::timestamp at time zone 'America/Chicago', null),
                    ${sql.json((opts.payload ?? policy()) as never)})`;
  const member = async (hire: string | null) =>
    (await sql`insert into members (tenant_id, first_name, last_name, employment_type, hire_date)
               values (${t!.id}, 'Pat', ${`M${Math.random().toString(36).slice(2, 6)}`}, 'career_full_time', ${hire}) returning id`)[0]!.id as string;
  return { tenant: t!.id as string, bank: b!.id as string, member };
}

const earns = (tenant: string, member: string) =>
  sql`select run_key, hours::float8 as hours, effective_date::text as eff, policy_version, explain
      from leave_ledger where tenant_id = ${tenant} and member_id = ${member} and kind = 'earn' order by run_key`;

afterAll(async () => {
  await sql`delete from tenants where id = any(${tenants})`;
  await sql.end();
});

describe('runAccruals', () => {
  const NOW = new Date('2026-04-15T12:00:00Z'); // 2026-04-15 in America/Chicago

  it('posts completed periods once, with proration and explain, and never twice', async () => {
    const w = await setup();
    const m = await w.member('2026-01-10');
    const first = await runAccruals(sql, NOW);
    expect(first.posted).toBeGreaterThanOrEqual(3);
    const rows = await earns(w.tenant, m);
    expect(rows.map((r) => r.run_key)).toEqual(['earn:2026-01-01', 'earn:2026-02-01', 'earn:2026-03-01']);
    expect(rows.map((r) => r.hours)).toEqual([5.68, 8, 8]); // Jan: 8 × 22/31
    expect(rows.map((r) => r.eff)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(rows[0]!.policy_version).toBe(1);
    expect((rows[0]!.explain as { rule: string }[]).some((e) => e.rule === 'accrual.prorate')).toBe(true);

    await runAccruals(sql, NOW);
    expect((await earns(w.tenant, m)).length).toBe(3);
    // April is not over yet, so nothing for it until May 1.
    await runAccruals(sql, new Date('2026-05-02T12:00:00Z'));
    expect((await earns(w.tenant, m)).map((r) => r.run_key)).toContain('earn:2026-04-01');
  });

  it('stops at the cap using the running balance', async () => {
    const w = await setup({ payload: policy({ cap: 20 }) });
    const m = await w.member('2025-01-01');
    await runAccruals(sql, NOW);
    expect((await earns(w.tenant, m)).map((r) => r.hours)).toEqual([8, 8, 4]); // Jan, Feb, Mar of 2026 reach 20
  });

  it('ignores draft policies', async () => {
    const w = await setup({ status: 'draft' });
    const m = await w.member('2025-01-01');
    await runAccruals(sql, NOW);
    expect((await earns(w.tenant, m)).length).toBe(0);
  });

  it('does not accrue for separated members', async () => {
    const w = await setup();
    const m = await w.member('2025-01-01');
    await sql`update members set status = 'separated', separated_on = '2026-01-15' where id = ${m}`;
    await runAccruals(sql, NOW);
    expect((await earns(w.tenant, m)).length).toBe(0);
  });

  it('expires hours above the carryover max once at the reset date', async () => {
    const w = await setup({ payload: policy({ tiers: [{ fromYears: 0, earn: { method: 'manual' } }], carryover: { max: 40, resetOn: '01-01' } }) });
    const m = await w.member('2020-01-01');
    await sql`insert into leave_ledger (tenant_id, member_id, bank_id, kind, hours, effective_date, note)
              values (${w.tenant}, ${m}, ${w.bank}, 'adjust', 55, '2026-06-01', 'test balance')`;
    const now = new Date('2027-02-10T12:00:00Z');
    await runAccruals(sql, now);
    await runAccruals(sql, now);
    const exp = await sql`select run_key, hours::float8 as hours, effective_date::text as eff from leave_ledger
                          where member_id = ${m} and kind = 'expire'`;
    expect(exp).toEqual([{ run_key: 'expire:2027-01-01', hours: -15, eff: '2027-01-01' }]);
  });

  it('one failing member does not block the others, and the run reports it', async () => {
    const w = await setup();
    const bad = await w.member('2025-06-01');
    const good = await w.member('2025-06-01');
    await sql.unsafe(`
      create or replace function pg_temp.noop() returns void language sql as 'select 1';
      create or replace function public.test_boom() returns trigger language plpgsql as $$
      begin
        if new.member_id = '${bad}' then raise exception 'boom for test'; end if;
        return new;
      end $$;
      create trigger test_boom before insert on public.leave_ledger for each row execute function public.test_boom();`);
    try {
      await expect(runAccruals(sql, NOW)).rejects.toThrow(/failed/);
    } finally {
      await sql.unsafe('drop trigger if exists test_boom on public.leave_ledger; drop function if exists public.test_boom();');
    }
    expect((await earns(w.tenant, good)).length).toBeGreaterThan(0);
    expect((await earns(w.tenant, bad)).length).toBe(0);
  });

  it('keeps exactly one pending next run queued', async () => {
    await sql`delete from jobs where kind = 'leave-accrual'`;
    await runAccruals(sql, NOW);
    await runAccruals(sql, NOW);
    const [j] = await sql`select count(*)::int as n, min(run_after)::text as at from jobs where kind = 'leave-accrual' and status = 'pending'`;
    expect(j!.n).toBe(1);
    expect(new Date(j!.at as string).toISOString()).toBe('2026-04-16T06:00:00.000Z');
  });
});
