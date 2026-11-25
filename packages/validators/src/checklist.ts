import { z } from 'zod';
import { keySchema, labelSchema, optionalUuid } from './common';
import { keyFromLabel } from './people';

export const CHECKLIST_KINDS = ['pass_fail', 'number', 'text'] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];
export type ChecklistItem = { key: string; label: string; kind: ChecklistKind; required: boolean };

/**
 * One item per line: `Label | kind | required`. kind is pass_fail (default), number or text;
 * add `optional` to make an item skippable. Keys are made from the labels.
 */
export function parseChecklistItems(text: string): { ok: true; items: ChecklistItem[] } | { ok: false; error: string } {
  const items: ChecklistItem[] = [];
  const used = new Set<string>();
  for (const [n, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line) continue;
    const [labelPart, kindPart, reqPart] = line.split('|').map((p) => p.trim());
    const label = labelPart ?? '';
    const kind = (kindPart || 'pass_fail') as ChecklistKind;
    if (!label || label.length > 200) return { ok: false, error: `Line ${n + 1}: enter a label of up to 200 characters.` };
    if (!(CHECKLIST_KINDS as readonly string[]).includes(kind)) return { ok: false, error: `Line ${n + 1}: the type must be pass_fail, number or text.` };
    const base = keyFromLabel(label);
    let key = base;
    for (let i = 2; used.has(key); i++) key = `${base.slice(0, 36)}_${i}`;
    used.add(key);
    items.push({ key, label, kind, required: (reqPart ?? 'required') !== 'optional' });
  }
  if (items.length === 0) return { ok: false, error: 'Add at least one item.' };
  if (items.length > 200) return { ok: false, error: 'A checklist can have at most 200 items.' };
  return { ok: true, items };
}

export const checklistItemsToText = (items: ChecklistItem[]): string =>
  items.map((i) => `${i.label} | ${i.kind}${i.required ? '' : ' | optional'}`).join('\n');

export const checklistTemplateSchema = z
  .object({
    label: labelSchema,
    key: keySchema.optional().or(z.literal('')),
    assetTypeId: optionalUuid,
    logFailure: z.coerce.boolean().optional(),
    items: z.string(),
  })
  .transform((v, ctx) => {
    const parsed = parseChecklistItems(v.items);
    if (!parsed.ok) {
      ctx.addIssue({ code: 'custom', path: ['items'], message: parsed.error });
      return z.NEVER;
    }
    return { label: v.label, key: v.key || keyFromLabel(v.label), assetTypeId: v.assetTypeId, logFailure: v.logFailure ?? true, items: parsed.items };
  });

/** Reads a completion form: field `answer.<key>` per item. Blank answers are omitted. */
export function answersFromForm(items: ChecklistItem[], form: FormData): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const i of items) {
    const raw = String(form.get(`answer.${i.key}`) ?? '').trim();
    if (raw === '') continue;
    out[i.key] = i.kind === 'number' ? Number(raw) : raw;
  }
  return out;
}

export const completeChecklistSchema = z.object({
  templateId: z.uuid(),
  assetId: optionalUuid,
  orgUnitId: optionalUuid,
  stockLocationId: optionalUuid,
  note: z.string().trim().max(500).optional().transform((v) => v || null),
});
