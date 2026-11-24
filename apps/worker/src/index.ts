import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { createSmtpMailer } from './mailer';
import { sendEmail } from './jobs/send-email';
import { inviteMember, type AuthAdmin } from './jobs/invite-member';
import { runOnce, type Handlers } from './runner';

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

const sql = postgres(env('SOMA_DB_URL'), { max: 2, onnotice: () => undefined });
const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const auth: AuthAdmin = {
  async inviteUserByEmail(email, redirectTo) {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });
    return error || !data.user ? { error: error?.message ?? 'no user returned' } : { userId: data.user.id };
  },
};
const mailer = createSmtpMailer(env('SMTP_URL'));
const handlers: Handlers = {
  'send-email': (p) => sendEmail(p, mailer),
  'invite-member': (p) => inviteMember(p, { sql, auth, mailer, appUrl: process.env.APP_URL ?? 'http://localhost:3000' }),
};

if (process.argv.includes('--once')) {
  const n = await runOnce(sql, handlers);
  console.log(`processed ${n} job(s)`);
  await sql.end();
} else {
  console.log('SomaOS worker started');
  for (;;) {
    try {
      await runOnce(sql, handlers);
    } catch (e) {
      console.error('worker loop error', e);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}
