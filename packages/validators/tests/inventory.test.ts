import { describe, expect, it } from 'vitest';
import {
  adjustStockSchema, assetEventSchema, assetTypeSchema, checklistItemsToText, checklistTemplateSchema, parseChecklistItems,
  parSchema, transferStockSchema, useStockSchema,
} from '../src';

const id = () => crypto.randomUUID();

describe('asset schemas', () => {
  it('derives a type key and rejects unknown categories', () => {
    expect(assetTypeSchema.parse({ label: 'Cardiac monitor', category: 'medical_device' }).key).toBe('cardiac_monitor');
    expect(assetTypeSchema.safeParse({ label: 'X', category: 'vehicle' }).success).toBe(false);
  });
  it('status, move and note events need what they need', () => {
    const base = { assetId: id() };
    expect(assetEventSchema.safeParse({ ...base, kind: 'status_change', toStatus: '' }).success).toBe(false);
    expect(assetEventSchema.safeParse({ ...base, kind: 'status_change', toStatus: 'out_of_service', note: 'no' }).success).toBe(false);
    expect(assetEventSchema.safeParse({ ...base, kind: 'status_change', toStatus: 'out_of_service', note: 'Pump failed' }).success).toBe(true);
    expect(assetEventSchema.safeParse({ ...base, kind: 'status_change', toStatus: 'reserve' }).success).toBe(true);
    expect(assetEventSchema.safeParse({ ...base, kind: 'status_change', toStatus: 'broken' }).success).toBe(false);
    expect(assetEventSchema.safeParse({ ...base, kind: 'assignment', toOrgUnitId: '' }).success).toBe(false);
    expect(assetEventSchema.safeParse({ ...base, kind: 'assignment', toOrgUnitId: id() }).success).toBe(true);
    expect(assetEventSchema.safeParse({ ...base, kind: 'note' }).success).toBe(false);
  });
});

describe('checklist items text', () => {
  it('parses lines into keyed items and round-trips', () => {
    const r = parseChecklistItems('Tires and lights\nFuel level | number\nAnything else | text | optional');
    expect(r.ok && r.items).toEqual([
      { key: 'tires_and_lights', label: 'Tires and lights', kind: 'pass_fail', required: true },
      { key: 'fuel_level', label: 'Fuel level', kind: 'number', required: true },
      { key: 'anything_else', label: 'Anything else', kind: 'text', required: false },
    ]);
    if (r.ok) expect(parseChecklistItems(checklistItemsToText(r.items))).toEqual(r);
  });
  it('makes duplicate labels unique, and rejects empty, unknown kinds and oversize lists', () => {
    const dup = parseChecklistItems('Lights\nLights');
    expect(dup.ok && dup.items.map((i) => i.key)).toEqual(['lights', 'lights_2']);
    expect(parseChecklistItems('  \n ').ok).toBe(false);
    expect(parseChecklistItems('Tires | checkbox').ok).toBe(false);
    expect(parseChecklistItems(Array.from({ length: 201 }, (_, i) => `Item ${i}`).join('\n')).ok).toBe(false);
  });
  it('the template schema surfaces item errors on the items field', () => {
    const bad = checklistTemplateSchema.safeParse({ label: 'Daily', items: 'Tires | checkbox' });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]!.path).toEqual(['items']);
    const ok = checklistTemplateSchema.parse({ label: 'Daily check', items: 'Tires' });
    expect(ok).toMatchObject({ key: 'daily_check', logFailure: true });
  });
});

describe('inventory schemas', () => {
  it('quantities must be positive with at most 3 decimals', () => {
    const base = { locationId: id(), itemId: id() };
    expect(useStockSchema.safeParse({ ...base, quantity: '0' }).success).toBe(false);
    expect(useStockSchema.safeParse({ ...base, quantity: '-1' }).success).toBe(false);
    expect(useStockSchema.safeParse({ ...base, quantity: '1.0005' }).success).toBe(false);
    expect(useStockSchema.parse({ ...base, quantity: '2.5' }).quantity).toBe(2.5);
  });
  it('adjust needs a non-zero change and a reason; transfer needs two different places; par ≥ min', () => {
    const base = { locationId: id(), itemId: id() };
    expect(adjustStockSchema.safeParse({ ...base, delta: '0', reason: 'Recount done' }).success).toBe(false);
    expect(adjustStockSchema.safeParse({ ...base, delta: '-3', reason: 'no' }).success).toBe(false);
    expect(adjustStockSchema.safeParse({ ...base, delta: '-3', reason: 'Damaged in transit' }).success).toBe(true);
    const a = id();
    expect(transferStockSchema.safeParse({ fromId: a, toId: a, itemId: id(), quantity: 1 }).success).toBe(false);
    expect(transferStockSchema.safeParse({ fromId: a, toId: id(), itemId: id(), quantity: 1 }).success).toBe(true);
    expect(parSchema.safeParse({ ...base, par: 5, min: 6 }).success).toBe(false);
    expect(parSchema.parse({ ...base, par: 5 }).min).toBe(0);
  });
});
