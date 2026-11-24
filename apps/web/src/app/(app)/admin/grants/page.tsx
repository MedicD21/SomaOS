import { PERMISSIONS } from '@soma/auth';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { AddGrantForm, CheckAccessForm, RevokeForm } from './forms';

type GrantRow = { id: string; member: string; role: string; scope_kind: string; unit: string | null; shift: string | null; valid_from: Date; valid_to: Date | null };

export default async function GrantsPage() {
  const ctx = await getRequestContext();
  const d = check(ctx, 'admin.roles.manage');
  if (!d.allowed) return <Forbidden reason={d.reason} />;
  const data = await withCtxDb(ctx, async (tx) => ({
    members: await tx<{ id: string; label: string }[]>`select id, last_name || ', ' || first_name as label from members where status <> 'separated' order by last_name, first_name`,
    roles: await tx<{ id: string; label: string }[]>`select id, label from roles order by label`,
    units: await tx<{ id: string; label: string }[]>`select id, name as label from org_units where status = 'active' order by path`,
    shifts: await tx<{ id: string; label: string }[]>`select id, label from shifts order by sort`,
    grants: await tx<GrantRow[]>`
      select g.id, m.last_name || ', ' || m.first_name as member, r.label as role, g.scope_kind, ou.name as unit, s.label as shift,
             lower(g.valid) as valid_from, upper(g.valid) as valid_to
      from role_grants g join members m on m.id = g.member_id join roles r on r.id = g.role_id
      left join org_units ou on ou.id = g.scope_org_unit_id left join shifts s on s.id = g.scope_shift_id
      where upper_inf(g.valid) or upper(g.valid) > now()
      order by m.last_name, r.label`,
  }));
  const fmt = (dt: Date | null) => (dt ? dt.toLocaleDateString('en-US', { timeZone: ctx.tenant.timezone }) : '—');
  const permissions = Object.entries(PERMISSIONS).map(([id, p]) => ({ id, label: p.label }));
  const scopeLabel = (g: GrantRow) => (g.scope_kind === 'department' ? 'Whole department' : g.scope_kind === 'self' ? 'Own records' : g.unit ?? '—');
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Grants</h1>
      <Card title="Give a role to a member"><AddGrantForm members={[...data.members]} roles={[...data.roles]} units={[...data.units]} shifts={[...data.shifts]} /></Card>
      <Card title="Why can / can't someone do something?"><CheckAccessForm members={[...data.members]} permissions={permissions} units={[...data.units]} shifts={[...data.shifts]} /></Card>
      <Card title="Current and upcoming grants">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr><th scope="col" className="py-2">Member</th><th scope="col">Role</th><th scope="col">Scope</th><th scope="col">Shift</th><th scope="col">From</th><th scope="col">Until</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.grants.map((g) => (
                <tr key={g.id} className="border-t border-line align-top">
                  <td className="py-2">{g.member}</td><td>{g.role}</td><td>{scopeLabel(g)}</td><td>{g.shift ?? 'Any'}</td>
                  <td>{fmt(g.valid_from)}</td><td>{fmt(g.valid_to)}</td>
                  <td><RevokeForm id={g.id} label={`Revoke ${g.role} from ${g.member}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
