import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getClaims } from '@/server/context';
import { withUserDb } from '@/server/db';
import { signOut } from '../(auth)/login/actions';
import { acceptInvite } from './actions';

export default async function InvitesPage() {
  const claims = await getClaims();
  if (!claims) redirect('/login');
  const invites = await withUserDb(claims, (tx) => tx<{ id: string; tenant_name: string; created_at: Date }[]>`
    select id, tenant_name, created_at from app.my_invites()`);
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-12">
      <h1 className="text-2xl font-bold">{invites.length ? 'Department invitations' : 'No active department'}</h1>
      {invites.length === 0 ? (
        <Card>
          <p>Your account is not an active member of any department. Ask your department administrator to invite you.</p>
        </Card>
      ) : (
        invites.map((i) => (
          <Card key={i.id}>
            <p className="mb-3">
              <strong>{i.tenant_name}</strong> invited you to join their department on SomaOS.
            </p>
            <form action={acceptInvite}>
              <input type="hidden" name="inviteId" value={i.id} />
              <Button type="submit" aria-label={`Accept invitation to ${i.tenant_name}`}>Accept invitation</Button>
            </form>
          </Card>
        ))
      )}
      <form action={signOut}><Button type="submit" variant="secondary">Sign out</Button></form>
    </main>
  );
}
