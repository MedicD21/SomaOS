import { Forbidden } from '@/components/forbidden';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { check, getRequestContext, withCtxDb } from '@/server/context';

const TABLES = ['members', 'member_assignments', 'org_units', 'ranks', 'shifts', 'roles', 'role_permissions', 'role_grants',
  'tenant_settings', 'tenants', 'memberships', 'custom_field_defs', 'config_versions', 'attachments',
  'seats', 'standing_seats', 'shift_assignments'];

type Row = { id: string; occurred_at: Date; actor: string | null; table_name: string; action: string; changed_fields: string[] | null; reason: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null };

/** Human label for the audited record, from its row snapshot. */
function describe(r: Row): string {
  const v = r.after ?? r.before ?? {};
  if (typeof v.last_name === 'string') return `${v.last_name}, ${String(v.first_name ?? '')}`;
  for (const k of ['name', 'label', 'key', 'permission']) if (typeof v[k] === 'string') return v[k] as string;
  return '—';
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getRequestContext();
  const d = check(ctx, 'admin.audit.view');
  if (!d.allowed) return <Forbidden reason={d.reason} />;
  const table = TABLES.includes(sp.table ?? '') ? sp.table! : null;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? '') ? sp.from! : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? '') ? sp.to! : null;
  const tz = ctx.tenant.timezone;
  const rows = await withCtxDb(ctx, (tx) => tx<Row[]>`
    select a.id::text, a.occurred_at, m.last_name || ', ' || m.first_name as actor, a.table_name, a.action, a.changed_fields, a.reason, a.before, a.after
    from audit_log a left join members m on m.user_id = a.actor_user_id and m.tenant_id = a.tenant_id
    where (${table}::text is null or a.table_name = ${table})
      and (${from}::date is null or a.occurred_at >= (${from}::date)::timestamp at time zone ${tz})
      and (${to}::date is null or a.occurred_at < ((${to}::date) + 1)::timestamp at time zone ${tz})
    order by a.occurred_at desc limit 200`);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Audit log</h1>
      <Card>
        <form method="get" className="grid items-end gap-3 sm:grid-cols-4" aria-label="Filter audit log">
          <Field id="a-table" label="Record type"><Select id="a-table" name="table" defaultValue={table ?? ''}><option value="">All</option>{TABLES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
          <Field id="a-from" label="From"><Input id="a-from" name="from" type="date" defaultValue={from ?? ''} /></Field>
          <Field id="a-to" label="To"><Input id="a-to" name="to" type="date" defaultValue={to ?? ''} /></Field>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
      </Card>
      <Card title={`Latest ${rows.length} changes`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr><th scope="col" className="py-2">When</th><th scope="col">Who</th><th scope="col">Record</th><th scope="col">Type</th><th scope="col">Action</th><th scope="col">Fields</th><th scope="col">Reason</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="py-2 whitespace-nowrap">{r.occurred_at.toLocaleString('en-US', { timeZone: tz })}</td>
                  <td>{r.actor ?? 'System'}</td><td>{describe(r)}</td><td>{r.table_name}</td><td>{r.action}</td>
                  <td>{r.changed_fields?.join(', ') ?? '—'}</td><td>{r.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
