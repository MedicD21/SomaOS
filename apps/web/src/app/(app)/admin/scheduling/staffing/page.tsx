import { localDateOf, type StaffingRules } from '@soma/schedule-engine';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { listStaffingVersions } from '@/server/scheduling/staffing';
import { ApproveStaffingForm, StaffingRulesForm, type StaffingFormValues } from './forms';

function summary(r: StaffingRules): string {
  const parts = r.groups.map((g) => `${g.label} = ${g.credentialKeys.join(' or ')}`);
  for (const m of r.departmentMinimums) parts.push(`department ≥ ${m.min} ${r.groups.find((g) => g.key === m.group)?.label ?? m.group}`);
  for (const u of r.unitRules) parts.push(`each ${u.unitTypeKey} ≥ ${u.min} ${r.groups.find((g) => g.key === u.group)?.label ?? u.group}`);
  return parts.join(' · ');
}

function formValues(r: StaffingRules | undefined): StaffingFormValues {
  const g = r?.groups[0];
  const key = g?.key ?? 'als';
  const unit = r?.unitRules.find((u) => u.group === key);
  return {
    groupKey: key,
    groupLabel: g?.label ?? 'ALS',
    credentialKeys: g?.credentialKeys ?? [],
    departmentMin: r?.departmentMinimums.find((m) => m.group === key)?.min ?? null,
    unitTypeKey: unit?.unitTypeKey ?? null,
    unitMin: unit?.min ?? null,
  };
}

export default async function StaffingRulesPage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('scheduling')) return <Forbidden reason="Scheduling is not enabled for this department." />;
  const d = check(ctx, 'scheduling.config.manage');
  if (!d.allowed) return <Forbidden reason={d.reason} />;
  const canApprove = check(ctx, 'admin.config.manage').allowed;
  const today = localDateOf(new Date(), ctx.tenant.timezone);

  const { versions, credentialTypes, unitTypes } = await withCtxDb(ctx, async (tx) => ({
    versions: await listStaffingVersions(tx),
    credentialTypes: [...(await tx<{ key: string; label: string }[]>`select key, label from credential_types where status = 'active' order by label`)],
    unitTypes: [...(await tx<{ key: string; label: string }[]>`select key, label from org_unit_types order by sort, label`)],
  }));
  const draft = versions.find((v) => v.status === 'draft');
  const current = versions.find((v) => v.status === 'approved' && (!v.fromDate || v.fromDate <= today)) ?? versions.find((v) => v.status === 'approved');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Staffing rules</h1>
      <p className="text-sm text-muted">
        The roster checks these rules every day: how many providers of a group (for example ALS) must be on duty across the
        department, and how many on every unit of a type. Below the department minimum, the mandate list suggests the next member up.
      </p>

      <Card title="Versions">
        {versions.length === 0 ? (
          <p className="text-sm">No staffing rules yet. Save a draft below, then approve it.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Staffing rule versions</caption>
              <thead>
                <tr>
                  <th scope="col" className="py-2 pr-3">Version</th>
                  <th scope="col" className="pr-3">Status</th>
                  <th scope="col" className="pr-3">From</th>
                  <th scope="col">Rules</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id} className="border-t border-line align-top">
                    <th scope="row" className="py-2 pr-3 font-medium">v{v.version}</th>
                    <td className="py-2 pr-3">{v.status}</td>
                    <td className="py-2 pr-3">{v.status === 'draft' ? 'not yet effective' : (v.fromDate ?? 'always')}</td>
                    <td className="py-2 break-words">{summary(v.payload)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={draft ? `Edit draft v${draft.version}` : 'New draft version'}>
        <StaffingRulesForm initial={formValues((draft ?? current)?.payload)} credentialTypes={credentialTypes} unitTypes={unitTypes} />
      </Card>

      {draft && (
        <Card title={`Approve draft v${draft.version}`}>
          {canApprove ? (
            <ApproveStaffingForm version={draft.version} defaultDate={today} />
          ) : (
            <p className="text-sm text-muted">Approving needs the configuration approval permission.</p>
          )}
        </Card>
      )}
    </div>
  );
}
