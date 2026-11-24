'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServer } from '@/lib/supabase/server';
import { getClaims } from '@/server/context';
import { withUserDb } from '@/server/db';

/** The signed-in user explicitly accepts one invitation addressed to their verified email. */
export async function acceptInvite(form: FormData): Promise<void> {
  const inviteId = z.uuid().parse(form.get('inviteId'));
  const claims = await getClaims();
  if (!claims) redirect('/login');
  const [row] = await withUserDb(claims, (tx) => tx<{ t: string }[]>`select app.accept_invite(${inviteId}) as t`);
  await withUserDb(claims, (tx) => tx`select app.set_active_tenant(${row!.t})`);
  const supabase = await createSupabaseServer();
  await supabase.auth.refreshSession();
  redirect('/');
}
