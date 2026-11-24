import type postgres from 'postgres';
import { z } from 'zod';

/** The slice of Supabase's admin auth API the invite job needs (injectable for tests). */
export interface AuthAdmin {
  inviteUserByEmail(email: string, redirectTo: string): Promise<{ userId: string } | { error: string }>;
}

const payloadSchema = z.object({ tenant_id: z.uuid(), member_id: z.uuid(), email: z.email() });

/**
 * Sends a Supabase Auth invitation, links the member record to the auth user, and adds an
 * `invited` membership (activated by app.accept_invites() on first sign-in). If the email
 * already has an account, it is linked without sending a new invitation.
 */
export async function inviteMember(
  payload: unknown,
  deps: { sql: postgres.Sql; auth: AuthAdmin; redirectTo: string },
): Promise<void> {
  const p = payloadSchema.parse(payload);
  const { sql } = deps;
  const existing = await sql<{ id: string }[]>`select id from auth.users where lower(email) = lower(${p.email}) and email_confirmed_at is not null`;
  let userId = existing[0]?.id;
  if (!userId) {
    const r = await deps.auth.inviteUserByEmail(p.email, deps.redirectTo);
    if ('error' in r) throw new Error(`invite failed: ${r.error}`);
    userId = r.userId;
  }
  await sql.begin(async (tx) => {
    await tx`insert into memberships (tenant_id, user_id, status) values (${p.tenant_id}, ${userId}, 'invited')
             on conflict (tenant_id, user_id) do nothing`;
    await tx`update members set user_id = ${userId} where id = ${p.member_id} and tenant_id = ${p.tenant_id} and user_id is null`;
  });
}
