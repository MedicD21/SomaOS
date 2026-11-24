import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { credentialExpiryScan } from '../../src/jobs/credential-expiry-scan';

const sql = postgres(process.env.SOMA_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { onnotice: () => undefined });

const NOW = new Date('2026-11-24T12:00:00Z'); // 2026-11-24 in America/Chicago
let tenantId: string;
let memberId: string;
let typeId: string;

beforeAll(async () => {
  const slug = `expiry-${Date.now()}`;
  tenantId = (await sql`insert into tenants (name, slug, timezone, department_type)
    values ('Expiry Test', ${slug}, 'America/Chicago', 'career') returning id`)[0]!.id as string;
  memberId = (await sql`insert into members (tenant_id, first_name, last_name, employment_type)
    values (${tenantId}, 'Pat', 'Medic', 'career_full_time') returning id`)[0]!.id as string;
  typeId = (await sql`insert into credential_types (tenant_id, key, label, validity, warn_days)
    values (${tenantId}, 'paramedic', 'Paramedic', '{"kind":"none"}', '{90,60,30,7}') returning id`)[0]!.id as string;
});
afterAll(async () => {
  await sql`delete from tenants where id = ${tenantId}`;
  await sql.end();
});
beforeEach(async () => {
  await sql`delete from jobs where kind = 'credential-expiry-scan'`;
  await sql`delete from notifications where tenant_id = ${tenantId}`;
  await sql`delete from member_credentials where tenant_id = ${tenantId}`;
  await sql`update members set status = 'active' where tenant_id = ${tenantId}`;
  await sql`update credential_types set warn_days = '{90,60,30,7}' where id = ${typeId}`;
  await sql`drop trigger if exists fail_notify on notifications`;
});

const addCredential = async (expiresOn: string, last: number | null, status = 'active') => {
  const [c] = await sql`insert into member_credentials (tenant_id, member_id, type_id, issued_on, expires_on, last_warned_days, status)
    values (${tenantId}, ${memberId}, ${typeId}, '2020-01-01', ${expiresOn}, ${last}, ${status}) returning id`;
  return c!.id as string;
};
const notes = () => sql`select kind, title, link from notifications where tenant_id = ${tenantId} order by created_at`;

describe('credentialExpiryScan', () => {
  it('warns once at the crossed threshold and schedules exactly one next scan', async () => {
    const id = await addCredential('2026-12-24', 60);
    await credentialExpiryScan(sql, NOW); // scan is global; assert on this tenant's rows only
    expect(await notes()).toEqual([
      { kind: 'credential.expiring', title: 'Paramedic expires in 30 days', link: `/admin/members/${memberId}` },
    ]);
    const [c] = await sql`select last_warned_days from member_credentials where id = ${id}`;
    expect(c!.last_warned_days).toBe(30);

    expect((await credentialExpiryScan(sql, NOW)).warned).toBe(0);
    expect(await notes()).toHaveLength(1);

    const jobs = await sql`select run_after from jobs where kind = 'credential-expiry-scan' and status = 'pending'`;
    expect(jobs).toHaveLength(1);
    expect(new Date(jobs[0]!.run_after).toISOString()).toBe('2026-11-25T06:00:00.000Z');
  });

  it('warns once that an expired credential has expired', async () => {
    await addCredential('2026-11-20', null);
    await credentialExpiryScan(sql, NOW);
    expect((await credentialExpiryScan(sql, NOW)).warned).toBe(0);
    expect((await notes()).map((n) => n.title)).toEqual(['Paramedic has expired']);
  });

  it('uses singular day and today wording', async () => {
    await sql`update credential_types set warn_days = '{90,60,30,7,1,0}' where id = ${typeId}`;
    await addCredential('2026-11-25', 7);
    await credentialExpiryScan(sql, NOW);
    await sql`update member_credentials set expires_on = '2026-11-24', last_warned_days = 1 where tenant_id = ${tenantId}`;
    await credentialExpiryScan(sql, NOW);
    expect((await notes()).map((n) => n.title)).toEqual(['Paramedic expires in 1 day', 'Paramedic expires today']);
  });

  it('ignores revoked credentials', async () => {
    await addCredential('2026-12-24', 60, 'revoked');
    await credentialExpiryScan(sql, NOW);
    expect(await notes()).toHaveLength(0);
  });

  it('ignores separated members', async () => {
    await addCredential('2026-12-24', 60);
    await sql`update members set status = 'separated' where id = ${memberId}`;
    await credentialExpiryScan(sql, NOW);
    expect(await notes()).toHaveLength(0);
  });

  it('isolates a failing row, still warns others, keeps the next job, and rethrows', async () => {
    const [bad] = await sql`insert into members (tenant_id, first_name, last_name, employment_type)
      values (${tenantId}, 'Bad', 'Row', 'career_full_time') returning id`;
    await sql.unsafe(`create or replace function public.fail_notify_fn() returns trigger language plpgsql as $f$
      begin
        if new.member_id = '${bad!.id}' then raise exception 'forced failure'; end if;
        return new;
      end $f$`);
    await sql.unsafe('create trigger fail_notify before insert on notifications for each row execute function public.fail_notify_fn()');
    await sql`insert into member_credentials (tenant_id, member_id, type_id, issued_on, expires_on, last_warned_days)
              values (${tenantId}, ${bad!.id}, ${typeId}, '2020-01-01', '2026-12-24', 60)`;
    await addCredential('2026-12-24', 60);
    await expect(credentialExpiryScan(sql, NOW)).rejects.toThrow(/1 of \d+ credential\(s\) failed/);
    expect((await notes()).map((n) => n.link)).toEqual([`/admin/members/${memberId}`]);
    const [bc] = await sql`select last_warned_days from member_credentials where member_id = ${bad!.id}`;
    expect(bc!.last_warned_days).toBe(60);
    expect(await sql`select 1 from jobs where kind = 'credential-expiry-scan' and status = 'pending'`).toHaveLength(1);
    await sql`drop trigger fail_notify on notifications`;
    await sql`drop function public.fail_notify_fn()`;
  });
});
