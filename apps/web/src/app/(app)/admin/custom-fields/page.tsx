import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { loadFieldDefs } from '@/server/custom-fields';
import { AddCustomFieldForm, ArchiveFieldForm } from './forms';

export default async function CustomFieldsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const entity = (await searchParams).entity === 'asset' ? 'asset' : 'member';
  const ctx = await getRequestContext();
  const d = check(ctx, 'admin.custom_fields.manage');
  if (!d.allowed) return <Forbidden reason={d.reason} />;
  const defs = await withCtxDb(ctx, (tx) => loadFieldDefs(tx, entity, true));
  const noun = entity === 'asset' ? 'asset' : 'member';
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Custom fields</h1>
      <nav aria-label="Field type" className="flex gap-3 text-sm">
        <a className={entity === 'member' ? 'font-semibold underline' : 'underline'} href="/admin/custom-fields">Member fields</a>
        <a className={entity === 'asset' ? 'font-semibold underline' : 'underline'} href="/admin/custom-fields?entity=asset">Asset fields</a>
      </nav>
      <p className="text-muted">Add your own fields to {noun} records. Archiving hides a field but keeps its saved values.</p>
      <Card title={`Add ${entity === 'asset' ? 'an asset' : 'a member'} field`}><AddCustomFieldForm entity={entity} /></Card>
      <Card title={entity === 'asset' ? 'Asset fields' : 'Member fields'}>
        <table className="w-full text-left text-sm">
          <thead><tr><th scope="col" className="py-2">Label</th><th scope="col">Key</th><th scope="col">Type</th><th scope="col">Required</th><th scope="col">Sensitivity</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {defs.map((f) => (
              <tr key={f.id} className="border-t border-line">
                <td className="py-2">{f.label}</td><td><code>{f.key}</code></td><td>{f.type}</td><td>{f.required ? 'Yes' : 'No'}</td>
                <td>{f.sensitivity ?? '—'}</td><td><ArchiveFieldForm id={f.id} label={f.label} archived={f.archived} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
