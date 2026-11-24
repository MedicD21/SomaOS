import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { signOut } from '../(auth)/login/actions';

export default function NoDepartmentPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Card title="No active department">
        <h1 className="sr-only">No active department</h1>
        <p className="mb-4">Your account is not an active member of any department. Ask your department administrator to invite you.</p>
        <form action={signOut}><Button type="submit" variant="secondary">Sign out</Button></form>
      </Card>
    </main>
  );
}
