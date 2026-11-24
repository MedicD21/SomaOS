import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { CredentialTypeForm, CredentialTypeStatusForm, type CredentialTypeValues, type Validity } from './forms';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function describe(v: Validity): string {
  if (v.kind === 'none') return 'Does not expire';
  if (v.kind === 'months') return `${v.months} months`;
  return `Cycle ends ${MONTHS[v.month - 1]} ${v.day}, every ${v.years} years`;
}

export default async function CredentialTypesPage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('scheduling')) return <Forbidden reason="Scheduling is not enabled for this department." />;
  const d = check(ctx, 'scheduling.config.manage');
  if (!d.allowed) return <Forbidden reason={d.reason} />;
  const rows = await withCtxDb(ctx, (tx) => tx<{ id: string; key: string; label: string; validity: Validity; warn_days: number[]; status: string }[]>`
    select id, key, label, validity, warn_days, status from credential_types order by status, label`);
  const types: CredentialTypeValues[] = rows.map((r) => ({ id: r.id, key: r.key, label: r.label, validity: r.validity, warnDays: r.warn_days, status: r.status }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Credential types</h1>
      <Card title="Add a credential type"><CredentialTypeForm /></Card>
      <Card title="Current credential types">
        <p className="mb-4 text-sm text-muted">
          Changing a type&apos;s validity does not recompute expiry dates already recorded for members. Archived types cannot be given
          to members but stay on existing records.
        </p>
        <div className="relative overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Credential types</caption>
            <thead>
              <tr>
                <th scope="col" className="py-2 pr-3">Type</th>
                <th scope="col" className="pr-3">Validity</th>
                <th scope="col" className="pr-3">Warnings (days)</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {types.map((ty) => (
                <tr key={ty.id} className="border-t border-line align-top">
                  <th scope="row" className="py-2 pr-3 font-medium">
                    {ty.label} <code className="text-xs font-normal text-muted">{ty.key}</code>
                    {ty.status === 'archived' && <span className="block text-xs font-normal text-muted">Archived</span>}
                  </th>
                  <td className="py-2 pr-3">{describe(ty.validity)}</td>
                  <td className="py-2 pr-3">{ty.warnDays.join(', ')}</td>
                  <td className="space-y-2 py-2">
                    <details>
                      <summary className="inline-flex min-h-11 cursor-pointer items-center underline">Edit {ty.label}</summary>
                      <CredentialTypeForm type={ty} />
                    </details>
                    <CredentialTypeStatusForm type={ty} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
