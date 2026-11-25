import Link from 'next/link';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { loadAssetTypes } from '@/server/inventory/assets';
import { AddAssetTypeForm, ArchiveTypeForm } from '../../assets/forms';

export default async function AssetTypesAdminPage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('inventory')) return <Forbidden reason="assets and inventory are not enabled for this department" />;
  const d = check(ctx, 'inventory.asset.manage');
  if (!d.allowed) return <Forbidden reason={d.reason} />;
  const types = await withCtxDb(ctx, (tx) => loadAssetTypes(tx, true));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Asset types</h1>
      <p className="text-muted">
        Types group your assets (apparatus, monitors, cots, turnout gear…). Fields every asset can carry are managed under{' '}
        <Link className="underline" href="/admin/custom-fields?entity=asset">Custom fields → Asset fields</Link>. Archiving a type keeps its assets.
      </p>
      <Card title="Add an asset type"><AddAssetTypeForm /></Card>
      <ul aria-label="Asset types" className="space-y-3">
        {types.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4">
            <span><span className="font-semibold">{t.label}</span> <span className="text-sm text-muted">· {t.category}{t.archived ? ' · archived' : ''}</span></span>
            <ArchiveTypeForm id={t.id} label={t.label} archived={t.archived} />
          </li>
        ))}
      </ul>
    </div>
  );
}
