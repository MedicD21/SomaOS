import { pathWithin } from '@soma/auth';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { AddUnitForm, EditUnitForm, type Option } from './org-forms';

type Unit = { id: string; name: string; code: string | null; type_id: string; type_label: string; parent_id: string | null; path: string; status: string };

export default async function OrgPage() {
  const ctx = await getRequestContext();
  const d = check(ctx, 'admin.org.manage');
  if (!d.allowed) return <Forbidden reason={d.reason} />;

  const { types, units } = await withCtxDb(ctx, async (tx) => ({
    types: await tx<{ id: string; label: string }[]>`select id, label from org_unit_types order by sort, label`,
    units: await tx<Unit[]>`
      select u.id, u.name, u.code, u.type_id, t.label as type_label, u.parent_id, u.path::text as path, u.status
      from org_units u join org_unit_types t on t.id = u.type_id order by u.path`,
  }));
  const typeOptions: Option[] = types.map((t) => ({ id: t.id, label: t.label }));
  const active = units.filter((u) => u.status === 'active');
  const children = (parentId: string | null) => units.filter((u) => u.parent_id === parentId).sort((a, b) => a.name.localeCompare(b.name));

  const renderNode = (u: Unit) => {
    const parents = active.filter((p) => !pathWithin(p.path, u.path)).map((p) => ({ id: p.id, label: p.name }));
    const kids = children(u.id);
    return (
      <li key={u.id} data-name={u.name} className="space-y-2">
        <div className="rounded-md border border-line bg-surface p-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-semibold">{u.name}</span>
            <span className="text-sm text-muted">{u.type_label}</span>
            {u.status === 'archived' && <span className="text-sm text-muted">(archived)</span>}
          </div>
          <details>
            <summary className="cursor-pointer text-sm underline">Edit {u.name}</summary>
            <EditUnitForm
              unit={{ id: u.id, name: u.name, typeId: u.type_id, parentId: u.parent_id, code: u.code, status: u.status }}
              types={typeOptions}
              parents={parents}
            />
          </details>
        </div>
        {kids.length > 0 && <ul className="ml-6 space-y-2 border-l border-line pl-4">{kids.map(renderNode)}</ul>}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Org structure</h1>
      <Card title="Add a unit">
        <AddUnitForm types={typeOptions} parents={active.map((p) => ({ id: p.id, label: p.name }))} />
      </Card>
      <section aria-labelledby="tree-heading">
        <h2 id="tree-heading" className="mb-3 text-lg font-semibold">Units</h2>
        {units.length === 0 ? <p className="text-muted">No units yet.</p> : <ul className="space-y-2">{children(null).map(renderNode)}</ul>}
      </section>
    </div>
  );
}
