'use server';
import {
  adjustStockSchema, itemSchema, parSchema, receiveStockSchema, stockLocationSchema, transferStockSchema, useStockSchema,
} from '@soma/validators';
import type { ActionResult } from '@/server/actions';
import { runAdmin, runScoped, zodFieldErrors } from '@/server/actions';

const f = (form: FormData, k: string) => form.get(k) ?? undefined;

export async function receiveStock(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = receiveStockSchema.safeParse({ locationId: form.get('locationId'), itemId: form.get('itemId'), quantity: form.get('quantity'), reference: f(form, 'reference') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped(['inventory.stock.manage'], async (tx) => {
    await tx`select app.receive_stock(${v.locationId}, ${v.itemId}, ${v.quantity}, ${tx.json(v.reference ? { note: v.reference } : {})})`;
    return `Received ${v.quantity}`;
  });
}

export async function useStock(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = useStockSchema.safeParse({ locationId: form.get('locationId'), itemId: form.get('itemId'), quantity: form.get('quantity'), reason: f(form, 'reason') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped(['inventory.stock.use', 'inventory.stock.manage'], async (tx) => {
    await tx`select app.use_stock(${v.locationId}, ${v.itemId}, ${v.quantity}, ${v.reason})`;
    return `Used ${v.quantity}`;
  });
}

export async function adjustStock(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = adjustStockSchema.safeParse({ locationId: form.get('locationId'), itemId: form.get('itemId'), delta: form.get('delta'), reason: form.get('reason') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped(['inventory.stock.manage'], async (tx) => {
    await tx`select app.adjust_stock(${v.locationId}, ${v.itemId}, ${v.delta}, ${v.reason})`;
    return `Adjusted by ${v.delta}`;
  });
}

export async function transferStock(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = transferStockSchema.safeParse({ fromId: form.get('fromId'), toId: form.get('toId'), itemId: form.get('itemId'), quantity: form.get('quantity'), note: f(form, 'note') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped(['inventory.stock.use', 'inventory.stock.manage'], async (tx) => {
    await tx`select app.transfer_stock(${v.fromId}, ${v.toId}, ${v.itemId}, ${v.quantity}, ${v.note})`;
    return `Transferred ${v.quantity}`;
  });
}

export async function setPar(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = parSchema.safeParse({ locationId: form.get('locationId'), itemId: form.get('itemId'), par: form.get('par'), min: form.get('min') || 0 });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped(['inventory.stock.manage'], async (tx) => {
    await tx`select app.set_par(${v.locationId}, ${v.itemId}, ${v.par}, ${v.min})`;
    return `Par set to ${v.par}`;
  });
}

export async function addItem(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = itemSchema.safeParse({ name: form.get('name'), sku: f(form, 'sku'), category: form.get('category'), unit: form.get('unit') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('inventory.stock.manage', form, async (tx) => {
    await tx`insert into items (tenant_id, name, sku, category, unit) values (app.tenant_id(), ${v.name}, ${v.sku}, ${v.category}, ${v.unit})`;
    return `Added ${v.name}`;
  });
}

export async function setItemArchived(id: string, archived: boolean): Promise<ActionResult> {
  return runAdmin('inventory.stock.manage', null, async (tx) => {
    await tx`update items set archived_at = ${archived ? new Date() : null} where id = ${id}`;
    return archived ? 'Archived' : 'Restored';
  });
}

export async function addLocation(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = stockLocationSchema.safeParse({ name: form.get('name'), kind: form.get('kind'), parentId: form.get('parentId'), orgUnitId: form.get('orgUnitId') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runScoped(['inventory.stock.manage'], async (tx) => {
    await tx`select app.create_stock_location(${v.name}, ${v.kind}, ${v.parentId}, ${v.orgUnitId})`;
    return `Added ${v.name}`;
  });
}

export async function archiveLocation(id: string): Promise<ActionResult> {
  return runScoped(['inventory.stock.manage'], async (tx) => {
    await tx`select app.archive_stock_location(${id})`;
    return 'Archived';
  });
}
