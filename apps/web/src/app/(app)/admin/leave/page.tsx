import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { BLANK_POLICY, listPolicyVersions, type PolicyVersion } from '@/server/leave/policies';
import { localDateOf } from '@soma/schedule-engine';
import { AddBankForm, AddLeaveTypeForm, AddLimitForm, AdjustForm, ArchiveBankForm, ArchiveLimitForm, ArchiveTypeForm, PolicyPanel } from './forms';

type Bank = { id: string; key: string; label: string; archived: boolean };
type Type = { id: string; label: string; bank_label: string | null; lead_time_days: number; requires_documentation: boolean; archived: boolean };
type Limit = { id: string; label: string; max: number; unit: string | null; shift: string | null; type: string | null; from: string; archived: boolean };
type Entry = { id: string; when: string; member: string; bank: string; kind: string; hours: number; note: string | null };

function policyStatus(versions: PolicyVersion[]): string {
  const current = versions.find((v) => v.status === 'approved' && v.toDate === null);
  const draft = versions.find((v) => v.status === 'draft');
  const parts: string[] = [];
  if (current) parts.push(`Approved v${current.version}${current.fromDate ? ` from ${current.fromDate}` : ''}`);
  if (draft) parts.push(`Draft v${draft.version} — not in effect until approved`);
  return parts.length ? parts.join(' · ') : 'No policy yet';
}

export default async function LeaveAdminPage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('leave')) return <Forbidden reason="leave is not enabled for this department" />;
  const d = check(ctx, 'leave.manage');
  if (!d.allowed) return <Forbidden reason={d.reason} />;
  const canApprove = check(ctx, 'admin.config.manage').allowed;

  const data = await withCtxDb(ctx, async (tx) => {
    const banks = await tx<Bank[]>`select id, key, label, archived_at is not null as archived from leave_banks order by archived_at nulls first, label`;
    const types = await tx<Type[]>`
      select t.id, t.label, b.label as bank_label, t.lead_time_days, t.requires_documentation, t.archived_at is not null as archived
      from leave_types t left join leave_banks b on b.id = t.bank_id order by t.archived_at nulls first, t.sort, t.label`;
    const members = await tx<{ id: string; label: string }[]>`
      select id, last_name || ', ' || first_name as label from members where status <> 'separated' order by last_name, first_name`;
    const entries = await tx<Entry[]>`
      select l.id::text, l.effective_date::text as when, m.last_name || ', ' || m.first_name as member, b.label as bank, l.kind,
             l.hours::float8 as hours, l.note
      from leave_ledger l join members m on m.id = l.member_id join leave_banks b on b.id = l.bank_id
      order by l.id desc limit 25`;
    const limits = await tx<Limit[]>`
      select l.id, l.label, l.max_concurrent as max, ou.name as unit, sh.label as shift, lt.label as type, lower(l.effective)::text as from,
             l.archived_at is not null as archived
      from leave_limits l left join org_units ou on ou.id = l.org_unit_id left join shifts sh on sh.id = l.shift_id
      left join leave_types lt on lt.id = l.leave_type_id order by l.archived_at nulls first, l.label`;
    const units = await tx<{ id: string; label: string }[]>`select id, name as label from org_units order by name`;
    const shifts = await tx<{ id: string; label: string }[]>`select id, label from shifts order by label`;
    const versions: Record<string, PolicyVersion[]> = {};
    for (const b of banks) if (!b.archived) versions[b.key] = await listPolicyVersions(tx, b.key);
    return { banks: [...banks], types: [...types], limits: [...limits], units: [...units], shifts: [...shifts], members: [...members], entries: [...entries], versions };
  });
  const active = data.banks.filter((b) => !b.archived);
  const bankOptions = active.map((b) => ({ id: b.id, label: b.label }));
  const hours = (n: number) => `${n > 0 ? '+' : ''}${Math.round(n * 100) / 100} h`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Leave</h1>

      <Card title="Leave banks">
        <ul aria-label="Leave banks" className="mb-4 space-y-2">
          {data.banks.map((b) => (
            <li key={b.id}>
              <span className="font-medium">{b.label}</span> <code className="text-sm text-muted">{b.key}</code>
              {b.archived && <span className="ml-2 text-sm text-muted">(archived)</span>}
              <details><summary className="cursor-pointer text-sm underline">Manage {b.label}</summary><ArchiveBankForm id={b.id} label={b.label} archived={b.archived} /></details>
            </li>
          ))}
        </ul>
        <AddBankForm />
      </Card>

      <Card title="Leave types">
        <ul aria-label="Leave types" className="mb-4 space-y-2">
          {data.types.map((t) => (
            <li key={t.id}>
              <span className="font-medium">{t.label}</span>
              <span className="text-sm text-muted"> · {t.bank_label ? `draws from ${t.bank_label}` : 'no balance'}{t.lead_time_days > 0 ? ` · ${t.lead_time_days} days notice` : ''}{t.requires_documentation ? ' · documentation required' : ''}</span>
              {t.archived && <span className="ml-2 text-sm text-muted">(archived)</span>}
              <details><summary className="cursor-pointer text-sm underline">Manage {t.label}</summary><ArchiveTypeForm id={t.id} label={t.label} archived={t.archived} /></details>
            </li>
          ))}
        </ul>
        <AddLeaveTypeForm banks={bankOptions} />
      </Card>

      <Card title="Leave limits">
        <p className="mb-3 text-sm text-muted">
          Cap how many members can be on approved leave on the same day. Members can still request; approving a request that goes over a limit
          needs a leave manager to override it with a reason.
        </p>
        <ul aria-label="Leave limits" className="mb-4 space-y-2">
          {data.limits.length === 0 && <li className="text-sm text-muted">No limits yet.</li>}
          {data.limits.map((l) => (
            <li key={l.id}>
              <span className="font-medium">{l.label}</span>
              <span className="text-sm text-muted"> · at most {l.max} · {l.unit ?? 'whole department'}{l.shift ? ` · ${l.shift} shift` : ''} · {l.type ?? 'any leave type'} · from {l.from}</span>
              {l.archived && <span className="ml-2 text-sm text-muted">(archived)</span>}
              <details><summary className="cursor-pointer text-sm underline">Manage {l.label}</summary><ArchiveLimitForm id={l.id} label={l.label} archived={l.archived} /></details>
            </li>
          ))}
        </ul>
        <AddLimitForm units={data.units} shifts={data.shifts} types={data.types.filter((t) => !t.archived).map((t) => ({ id: t.id, label: t.label }))} today={localDateOf(new Date(), ctx.tenant.timezone)} />
      </Card>

      <section aria-labelledby="policies-heading" className="space-y-4">
        <h2 id="policies-heading" className="text-lg font-semibold">Accrual policies</h2>
        <p className="text-sm text-muted">
          Policies from your department template are <strong>starter values</strong>: edit them to match your agreement, then approve. Nothing accrues until a policy is approved.
        </p>
        {active.map((b) => {
          const versions = data.versions[b.key] ?? [];
          const draft = versions.find((v) => v.status === 'draft') ?? null;
          const basis = draft ?? versions.find((v) => v.status === 'approved') ?? null;
          return (
            <Card key={b.id}>
              <h3 className="text-base font-semibold">{b.label} policy</h3>
              <p data-testid={`policy-status-${b.key}`} className="mb-3 text-sm">{policyStatus(versions)}</p>
              <PolicyPanel
                bankKey={b.key}
                bankLabel={b.label}
                initialJson={JSON.stringify(basis?.payload ?? BLANK_POLICY, null, 2)}
                draftVersion={draft?.version ?? null}
                canApprove={canApprove}
              />
            </Card>
          );
        })}
      </section>

      <Card title="Adjust a balance">
        <p className="mb-3 text-sm text-muted">Opening balances, corrections, or comp time earned outside SomaOS. Every change is recorded with your note.</p>
        <AdjustForm members={data.members} banks={bankOptions} />
      </Card>

      <section aria-labelledby="ledger-heading">
        <h2 id="ledger-heading" className="mb-3 text-lg font-semibold">Recent balance changes</h2>
        <ul aria-label="Recent balance changes" className="space-y-2">
          {data.entries.map((e) => (
            <li key={e.id} className="rounded-lg border border-line bg-surface p-3 text-sm">
              <span className="font-medium">{e.member}</span> · {e.bank} · {e.kind} · <strong>{hours(e.hours)}</strong> · {e.when}
              {e.note && <span className="block text-muted">{e.note}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
