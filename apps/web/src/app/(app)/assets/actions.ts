'use server';
import { archiveAssetSchema, assetEventSchema, assetSchema, assetTypeSchema } from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { runAdmin, runScoped, zodFieldErrors } from '@/server/actions';
import { getRequestContext, withCtxDb } from '@/server/context';
import { customFromForm, loadFieldDefs, validateCustom } from '@/server/custom-fields';

export async function createAsset(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = assetSchema.safeParse({ typeId: form.get('typeId'), name: form.get('name'), identifier: form.get('identifier') ?? undefined, orgUnitId: form.get('orgUnitId') });
  const ctx = await getRequestContext();
  const defs = await withCtxDb(ctx, (tx) => loadFieldDefs(tx, 'asset'));
  const custom = validateCustom(defs, customFromForm(defs, form));
  if (!parsed.success || !custom.ok) {
    const base = parsed.success ? { fieldErrors: {} } : zodFieldErrors(parsed.error.issues);
    return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: { ...base.fieldErrors, ...(custom.ok ? {} : custom.fieldErrors) } };
  }
  const v = parsed.data;
  return runScoped(['inventory.asset.manage'], async (tx) => {
    await tx`select app.create_asset(${v.typeId}, ${v.name}, ${v.identifier}, ${v.orgUnitId}, ${tx.json(custom.value as never)})`;
    return `Added ${v.name}`;
  });
}

/** Logs a note or maintenance entry, a status change, or a move, depending on `kind`. */
export async function logAssetEvent(assetId: string, kind: 'note' | 'maintenance' | 'status_change' | 'assignment', _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = assetEventSchema.safeParse({
    assetId, kind: form.get('kind') || kind, toStatus: form.get('toStatus') ?? '', toOrgUnitId: form.get('toOrgUnitId'), note: form.get('note') ?? undefined,
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped(['inventory.asset.event'], async (tx) => {
    await tx`select app.record_asset_event(${v.assetId}, ${v.kind}, ${v.toStatus ?? null}, ${v.toOrgUnitId}, ${v.note})`;
    return v.kind === 'status_change' ? 'Status updated' : v.kind === 'assignment' ? 'Asset moved' : 'Logged';
  });
}

export async function archiveAsset(assetId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = archiveAssetSchema.safeParse({ assetId, reason: form.get('reason') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped(['inventory.asset.manage'], async (tx) => {
    await tx`select app.archive_asset(${v.assetId}, ${v.reason})`;
    return 'Asset archived';
  });
}

export async function addAssetType(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = assetTypeSchema.safeParse({ label: form.get('label'), key: form.get('key') ?? '', category: form.get('category') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('inventory.asset.manage', form, async (tx) => {
    await tx`insert into asset_types (tenant_id, key, label, category) values (app.tenant_id(), ${v.key}, ${v.label}, ${v.category})`;
    return `Added ${v.label}`;
  });
}

export async function setAssetTypeArchived(id: string, archived: boolean): Promise<ActionResult> {
  return runAdmin('inventory.asset.manage', null, async (tx) => {
    await tx`update asset_types set archived_at = ${archived ? new Date() : null} where id = ${id}`;
    return archived ? 'Archived' : 'Restored';
  });
}
