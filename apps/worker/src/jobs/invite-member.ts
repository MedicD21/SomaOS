import type postgres from 'postgres';
import { z } from 'zod';
import type { Mailer } from '../mailer';
import { FROM } from '../mailer';

/** The slice of Supabase's admin auth API the invite job needs (injectable for tests). */
export interface AuthAdmin {
  inviteUserByEmail(email: string, redirectTo: string): Promise<{ userId: string } | { error: string }>;
}

const payloadSchema = z.object({
  invite_id: z.uuid(),
  tenant_id: z.uuid(),
  tenant_name: z.string(),
  email: z.email(),
});

/**
 * Delivers a member invitation. It never links accounts or creates memberships: the
 * invitee must sign in with the verified invited email and accept it themselves
 * (app.accept_invite). New emails get a Supabase invitation (account setup link);
 * existing accounts get a notice to sign in and accept.
 */
export async function inviteMember(
  payload: unknown,
  deps: { sql: postgres.Sql; auth: AuthAdmin; mailer: Mailer; appUrl: string },
): Promise<void> {
  const p = payloadSchema.parse(payload);
  const acceptUrl = `${deps.appUrl}/invites`;
  const existing = await deps.sql<{ id: string }[]>`select id from auth.users where lower(email) = lower(${p.email})`;
  if (existing.length === 0) {
    const r = await deps.auth.inviteUserByEmail(p.email, acceptUrl);
    if ('error' in r) throw new Error(`invite failed: ${r.error}`);
    return;
  }
  await deps.mailer.send({
    from: FROM,
    to: p.email,
    subject: `You have been invited to ${p.tenant_name} on SomaOS`,
    text: `${p.tenant_name} invited you to join their department on SomaOS.\n\nSign in and accept the invitation at:\n${acceptUrl}\n\nIf you did not expect this, you can ignore this email.`,
  });
}
