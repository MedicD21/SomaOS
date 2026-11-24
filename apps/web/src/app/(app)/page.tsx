import { Card } from '@/components/ui/card';
import { getRequestContext } from '@/server/context';

export default async function DashboardPage() {
  const ctx = await getRequestContext();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <Card title="Welcome">
        <p>
          You are signed in to <strong>{ctx.tenant.name}</strong>. Department time zone: {ctx.tenant.timezone}.
        </p>
      </Card>
    </div>
  );
}
