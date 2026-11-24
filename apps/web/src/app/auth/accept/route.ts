import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';
import { getClaims } from '@/server/context';
import { withUserDb } from '@/server/db';

/** Activates pending invitations for a signed-in user without an active department. */
export async function GET(request: NextRequest) {
  const claims = await getClaims();
  if (!claims) return NextResponse.redirect(new URL('/login', request.url));
  const [row] = await withUserDb(claims, (tx) => tx<{ n: number }[]>`select app.accept_invites() as n`);
  if (!row || row.n === 0) return NextResponse.redirect(new URL('/no-department', request.url));
  const supabase = await createSupabaseServer();
  await supabase.auth.refreshSession();
  return NextResponse.redirect(new URL('/', request.url));
}
