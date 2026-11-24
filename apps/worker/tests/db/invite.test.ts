import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { inviteMember, type AuthAdmin } from '../../src/jobs/invite-member';
import type { Mailer, MailMessage } from '../../src/mailer';

const sql = postgres(process.env.SOMA_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { onnotice: () => undefined });
afterAll(() => sql.end());

class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  async send(m: MailMessage) {
    this.sent.push(m);
  }
}

const payload = (email: string) => ({
  invite_id: crypto.randomUUID(), tenant_id: crypto.randomUUID(), tenant_name: 'Demo Fire Rescue', email,
});

describe('inviteMember', () => {
  it('sends a Supabase invitation to a new email and links nothing', async () => {
    const email = `new-${Date.now()}@example.test`;
    const calls: [string, string][] = [];
    const auth: AuthAdmin = { inviteUserByEmail: async (e, r) => (calls.push([e, r]), { userId: crypto.randomUUID() }) };
    const mailer = new FakeMailer();
    await inviteMember(payload(email), { sql, auth, mailer, appUrl: 'http://localhost:3000' });
    expect(calls).toEqual([[email, 'http://localhost:3000/invites']]);
    expect(mailer.sent).toEqual([]);
  });

  it('emails existing account holders a sign-in notice instead of auto-linking them', async () => {
    const email = `existing-${Date.now()}@example.test`;
    const [u] = await sql`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
                          values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${email}, now()) returning id`;
    const auth: AuthAdmin = { inviteUserByEmail: async () => { throw new Error('should not be called'); } };
    const mailer = new FakeMailer();
    await inviteMember(payload(email), { sql, auth, mailer, appUrl: 'http://localhost:3000' });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: email, subject: 'You have been invited to Demo Fire Rescue on SomaOS' });
    expect(mailer.sent[0]!.text).toContain('http://localhost:3000/invites');
    expect((await sql`select count(*)::int as n from memberships where user_id = ${u!.id}`)[0]!.n).toBe(0);
    await sql`delete from auth.users where id = ${u!.id}`;
  });
});
