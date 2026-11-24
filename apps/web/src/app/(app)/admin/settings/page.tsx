import { timezoneOptions } from '@soma/validators';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext } from '@/server/context';
import { SettingsForm } from './settings-form';

export default async function SettingsPage() {
  const ctx = await getRequestContext();
  const d = check(ctx, 'admin.tenant.manage');
  if (!d.allowed) return <Forbidden reason={d.reason} />;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Department settings</h1>
      <Card>
        <SettingsForm
          name={ctx.tenant.name}
          timezone={ctx.tenant.timezone}
          timezones={timezoneOptions()}
          terminology={ctx.tenant.terminology}
          enabledModules={ctx.tenant.enabledModules}
        />
      </Card>
    </div>
  );
}
