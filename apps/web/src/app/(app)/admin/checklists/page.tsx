import { checklistItemsToText } from '@soma/validators';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { loadAssetTypes } from '@/server/inventory/assets';
import { loadTemplates } from '@/server/inventory/checklists';
import { SaveChecklistForm } from '../../checks/forms';

export default async function ChecklistsAdminPage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('inventory')) return <Forbidden reason="assets and inventory are not enabled for this department" />;
  const d = check(ctx, 'inventory.check.manage');
  if (!d.allowed) return <Forbidden reason={d.reason} />;
  const data = await withCtxDb(ctx, async (tx) => ({ templates: await loadTemplates(tx), types: await loadAssetTypes(tx) }));
  const types = data.types.map((t) => ({ id: t.id, label: t.label }));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Checklists</h1>
      <p className="text-muted">
        Saving a checklist creates a new version. Checks already completed keep the questions and answers they were given.
        The starter checklists are generic examples: edit them to match your department.
      </p>
      <Card title="Add a checklist"><SaveChecklistForm types={types} /></Card>
      {data.templates.map((t) => (
        <Card key={t.id} title={`${t.label} (version ${t.version})`}>
          <SaveChecklistForm
            types={types}
            initial={{ key: t.key, label: t.label, assetTypeId: t.assetTypeId, logFailure: t.logFailure, itemsText: checklistItemsToText(t.items) }}
          />
        </Card>
      ))}
    </div>
  );
}
