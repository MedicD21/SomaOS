'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServer } from '@/lib/supabase/server';
import { getClaims } from '@/server/context';
import { withUserDb } from '@/server/db';

export async function switchTenant(form: FormData): Promise<void> {
  const tenantId = z.uuid().parse(form.get('tenantId'));
  const claims = await getClaims();
  if (!claims) redirect('/login');
  await withUserDb(claims, (tx) => tx`select app.set_active_tenant(${tenantId})`);
  const supabase = await createSupabaseServer();
  await supabase.auth.refreshSession();
  redirect('/');
}
