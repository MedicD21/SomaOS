'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServer } from '@/lib/supabase/server';

export type LoginState = { error: string | null };

const schema = z.object({ email: z.email(), password: z.string().min(1) });

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ email: form.get('email'), password: form.get('password') });
  if (!parsed.success) return { error: 'Invalid email or password' };
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: 'Invalid email or password' };
  redirect('/');
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect('/login');
}
