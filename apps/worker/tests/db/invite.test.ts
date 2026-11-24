import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { inviteMember, type AuthAdmin } from '../../src/jobs/invite-member';

const sql = postgres(process.env.SOMA_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { onnotice: () => undefined });
afterAll(() => sql.end());

describe('inviteMember', () => {
  it('invites by email, links the member and creates an invited membership', async () => {
    const [t] = await sql`select app.create_tenant('Invite FD', ${'inv-' + Date.now()}, 'UTC', 'career', null) as id`;
    const [m] = await sql`insert into members (tenant_id, first_name, last_name, employment_type, email)
                          values (${t!.id}, 'Ivy', 'Invitee', 'volunteer', ${`ivy-${Date.now()}@example.test`}) returning id, email`;
    const [u] = await sql`insert into auth.users (id, instance_id, aud, role, email) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${m!.email}) returning id`;
    const calls: string[] = [];
    const auth: AuthAdmin = { inviteUserByEmail: async (email) => (calls.push(email), { userId: u!.id }) };
    await inviteMember({ tenant_id: t!.id, member_id: m!.id, email: m!.email }, { sql, auth, redirectTo: 'http://localhost:3000/login' });
    expect(calls).toEqual([m!.email]);
    const [member] = await sql`select user_id from members where id = ${m!.id}`;
    expect(member!.user_id).toBe(u!.id);
    const [ms] = await sql`select status from memberships where tenant_id = ${t!.id} and user_id = ${u!.id}`;
    expect(ms!.status).toBe('invited');
    await sql`delete from tenants where id = ${t!.id}`;
    await sql`delete from auth.users where id = ${u!.id}`;
  });
});
