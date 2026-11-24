import { PERMISSIONS } from '@soma/auth';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { RoleForm, type PermissionGroup } from './role-form';

export default async function RolesPage() {
  const ctx = await getRequestContext();
  const d = check(ctx, 'admin.roles.manage');
  if (!d.allowed) return <Forbidden reason={d.reason} />;
  const roles = await withCtxDb(ctx, (tx) => tx<{ id: string; key: string; label: string; permissions: string[] }[]>`
    select r.id, r.key, r.label, coalesce(array_agg(rp.permission) filter (where rp.permission is not null), '{}') as permissions
    from roles r left join role_permissions rp on rp.role_id = r.id group by r.id order by r.label`);
  const groups: PermissionGroup[] = [];
  for (const [key, info] of Object.entries(PERMISSIONS)) {
    let g = groups.find((x) => x.module === info.module);
    if (!g) groups.push((g = { module: info.module, items: [] }));
    g.items.push({ key, label: info.label });
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Roles</h1>
      <p className="text-muted">Roles bundle permissions. Give a role to a member on the Grants page, scoped to the whole department, part of the org, or themselves.</p>
      <Card title="Add a role"><RoleForm groups={groups} /></Card>
      {roles.map((r) => (
        <Card key={r.id}>
          <h2 className="text-lg font-semibold">{r.label}</h2>
          <p className="mb-2 text-sm text-muted"><code>{r.key}</code> · {r.permissions.length} permissions</p>
          <details><summary className="cursor-pointer text-sm underline">Edit {r.label}</summary><RoleForm role={{ ...r, permissions: [...r.permissions] }} groups={groups} /></details>
        </Card>
      ))}
    </div>
  );
}
