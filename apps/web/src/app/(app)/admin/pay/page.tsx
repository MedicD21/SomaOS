import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { BLANK_RULES, listRuleVersions, type RulesVersion } from '@/server/pay/rules';
import { RuleWorkbench } from '@/components/rule-builder/RuleWorkbench';
import type { Doc } from '@/components/rule-builder/path';
import { approveRules, saveRules, simulatePayRules } from './actions';
import { AddGroupForm, AddPayCodeForm, ArchivePayCodeForm, AssignGroupForm, SetRateForm } from './forms';

type Code = { id: string; key: string; label: string; kind: string; multiplier: number; export_code: string | null; archived: boolean };
type Group = { id: string; key: string; label: string; archived: boolean };
type Rate = { id: string; member: string; rate: number; from: string; to: string | null };

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n);

function rulesStatus(versions: RulesVersion[]): string {
  const current = versions.find((v) => v.status === 'approved' && v.toDate === null);
  const draft = versions.find((v) => v.status === 'draft');
  const parts: string[] = [];
  if (current) parts.push(`Approved v${current.version}${current.fromDate ? ` from ${current.fromDate}` : ''}`);
  if (draft) parts.push(`Draft v${draft.version} — not in effect until approved`);
  return parts.length ? parts.join(' · ') : 'No rules yet';
}

export default async function PayAdminPage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('pay')) return <Forbidden reason="pay is not enabled for this department" />;
  const d = check(ctx, 'pay.manage');
  if (!d.allowed) return <Forbidden reason={d.reason} />;
  const canApprove = check(ctx, 'admin.config.manage').allowed;

  const data = await withCtxDb(ctx, async (tx) => {
    const codes = await tx<Code[]>`
      select id, key, label, kind, multiplier::float8 as multiplier, export_code, archived_at is not null as archived
      from pay_codes order by archived_at nulls first, sort, label`;
    const groups = await tx<Group[]>`select id, key, label, archived_at is not null as archived from employee_groups order by archived_at nulls first, label`;
    const members = await tx<{ id: string; label: string }[]>`
      select id, last_name || ', ' || first_name as label from members where status <> 'separated' order by last_name, first_name`;
    const rates = await tx<Rate[]>`
      select r.id, m.last_name || ', ' || m.first_name as member, r.hourly_rate::float8 as rate,
             lower(r.effective)::text as from, case when upper_inf(r.effective) then null else upper(r.effective)::text end as to
      from member_pay_rates r join members m on m.id = r.member_id order by lower(r.effective) desc, m.last_name limit 30`;
    const banks = await tx<{ key: string }[]>`select key from leave_banks where archived_at is null order by key`;
    const versions: Record<string, RulesVersion[]> = {};
    for (const g of groups) if (!g.archived) versions[g.key] = await listRuleVersions(tx, g.key);
    return { codes: [...codes], groups: [...groups], members: [...members], rates: [...rates], versions, banks: banks.map((b) => b.key) };
  });
  const groupOptions = data.groups.filter((g) => !g.archived).map((g) => ({ id: g.id, label: g.label }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Pay</h1>
      <p className="text-muted">Pay codes, who is in which group, hourly rates, and the rules that turn shifts into hours and dollars. Nothing here changes a schedule.</p>

      <Card title="Pay codes">
        <ul aria-label="Pay codes" className="mb-4 space-y-2">
          {data.codes.map((c) => (
            <li key={c.id}>
              <span className="font-medium">{c.label}</span> <code className="text-sm text-muted">{c.key}</code>
              <span className="text-sm text-muted"> · {c.kind} · {c.multiplier}×{c.export_code ? ` · exports as ${c.export_code}` : ''}</span>
              {c.archived && <span className="ml-2 text-sm text-muted">(archived)</span>}
              <details><summary className="cursor-pointer text-sm underline">Manage {c.label}</summary><ArchivePayCodeForm id={c.id} label={c.label} archived={c.archived} /></details>
            </li>
          ))}
        </ul>
        <AddPayCodeForm />
      </Card>

      <Card title="Employee groups">
        <p className="mb-3 text-sm text-muted">Each group has its own pay rules. Members with no group use the group named “default”.</p>
        <ul aria-label="Employee groups" className="mb-4 space-y-1">
          {data.groups.map((g) => (
            <li key={g.id}><span className="font-medium">{g.label}</span> <code className="text-sm text-muted">{g.key}</code>{g.archived && <span className="ml-2 text-sm text-muted">(archived)</span>}</li>
          ))}
        </ul>
        <div className="space-y-6">
          <AddGroupForm />
          <AssignGroupForm members={data.members} groups={groupOptions} />
        </div>
      </Card>

      <Card title="Hourly rates">
        <SetRateForm members={data.members} />
        <h3 className="mb-2 mt-6 text-base font-semibold">Recent rates</h3>
        <ul aria-label="Recent pay rates" className="space-y-1 text-sm">
          {data.rates.map((r) => (
            <li key={r.id}>{r.member} · <strong>{usd(r.rate)}/h</strong> · from {r.from}{r.to ? ` until ${r.to}` : ''}</li>
          ))}
        </ul>
      </Card>

      <section aria-labelledby="rules-heading" className="space-y-4">
        <h2 id="rules-heading" className="text-lg font-semibold">Pay rules</h2>
        <p className="text-sm text-muted">
          Rules from your department template are <strong>starter values</strong>, including the work-period threshold: check them against your own agreement, then approve.
          No pay period can be calculated until rules are approved.
        </p>
        {data.groups.filter((g) => !g.archived).map((g) => {
          const versions = data.versions[g.key] ?? [];
          const draft = versions.find((v) => v.status === 'draft') ?? null;
          const basis = draft ?? versions.find((v) => v.status === 'approved') ?? null;
          return (
            <Card key={g.id}>
              <h3 className="text-base font-semibold">{g.label}</h3>
              <p data-testid={`rules-status-${g.key}`} className="mb-3 text-sm">{rulesStatus(versions)}</p>
              <RuleWorkbench
                kind="pay"
                uid={g.key}
                label={g.label}
                initial={(basis?.payload ?? BLANK_RULES) as unknown as Doc}
                draftVersion={draft?.version ?? null}
                savedPayload={(draft?.payload ?? null) as unknown as Doc | null}
                versions={versions.map((v) => ({ version: v.version, status: v.status, fromDate: v.fromDate, payload: v.payload }))}
                suggestions={{ payCodes: data.codes.filter((c) => !c.archived).map((c) => c.key), banks: data.banks }}
                members={data.members}
                canApprove={canApprove}
                actions={{ save: saveRules, simulate: simulatePayRules, approve: approveRules }}
              />
            </Card>
          );
        })}
      </section>
    </div>
  );
}
