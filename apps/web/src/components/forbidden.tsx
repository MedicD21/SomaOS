import { Card } from '@/components/ui/card';

export function Forbidden({ reason }: { reason: string }) {
  return (
    <Card>
      <h1 className="mb-2 text-xl font-bold">Not allowed</h1>
      <p>You do not have permission to view this page.</p>
      <p className="mt-2 text-sm text-muted">Reason: {reason}</p>
    </Card>
  );
}
