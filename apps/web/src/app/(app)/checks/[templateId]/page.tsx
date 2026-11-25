import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { loadAssets, loadUnits } from '@/server/inventory/assets';
import { loadTemplate } from '@/server/inventory/checklists';
import { CompleteForm } from '../forms';

export default async function CompletePage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  if (!z.uuid().safeParse(templateId).success) notFound();
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('inventory')) return <Forbidden reason="assets and inventory are not enabled for this department" />;
  if (!hasAny(ctx, 'inventory.check.perform')) return <Forbidden reason="inventory.check.perform is required" />;
  const data = await withCtxDb(ctx, async (tx) => {
    const template = await loadTemplate(tx, templateId);
    if (!template) return null;
    // Locations are readable department-wide; the database checks the chosen one when the check is submitted.
    const assets = template.assetTypeId ? (await loadAssets(tx, { typeId: template.assetTypeId })).filter((a) => a.status !== 'retired') : null;
    return { template, assets, units: await loadUnits(tx) };
  });
  if (!data || !data.template.active) notFound();
  const { template, assets, units } = data;
  return (
    <div className="space-y-6">
      <p><Link className="underline" href="/checks">← All checks</Link></p>
      <h1 className="text-2xl font-bold">{template.label}</h1>
      <Card>
        {assets && assets.length === 0 ? <p>There are no assets of this type to check yet.</p> : (
          <CompleteForm
            templateId={template.id}
            label={template.label}
            items={template.items}
            assets={assets ? assets.map((a) => ({ id: a.id, label: `${a.name}${a.unitName ? ` — ${a.unitName}` : ''}` })) : null}
            units={units}
          />
        )}
      </Card>
    </div>
  );
}
