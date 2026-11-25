import { describe, expect, it } from 'vitest';
import {
  csAdministerSchema, csCountSchema, csDiscrepancyResolveSchema, csItemSchema, csMoveSchema, csReceiveSchema, csWasteSchema, csWitnessRequestSchema,
} from '../src';

const id = () => crypto.randomUUID();

describe('custody schemas', () => {
  it('quantities must be above zero with at most 3 decimals', () => {
    const base = { locationId: id(), lotId: id(), reference: 'PO 77' };
    expect(csReceiveSchema.safeParse({ ...base, qty: '2.5' }).success).toBe(true);
    for (const qty of ['0', '-1', '1.2345', '', 'abc']) expect(csReceiveSchema.safeParse({ ...base, qty }).success, qty).toBe(false);
  });

  it('administer needs a run or incident number and warns off patient identifiers by length only', () => {
    const base = { locationId: id(), lotId: id(), qty: '1' };
    expect(csAdministerSchema.safeParse({ ...base, reference: 'Run 2026-114' }).success).toBe(true);
    expect(csAdministerSchema.safeParse({ ...base, reference: 'no' }).success).toBe(false);
    expect(csAdministerSchema.safeParse({ ...base, reference: 'x'.repeat(201) }).success).toBe(false);
  });

  it('a transfer needs two different locations', () => {
    const a = id();
    expect(csMoveSchema.safeParse({ fromId: a, toId: a, lotId: id(), qty: '1' }).success).toBe(false);
    expect(csMoveSchema.safeParse({ fromId: a, toId: id(), lotId: id(), qty: '1', note: '' }).success).toBe(true);
  });

  it('waste needs a real reason; a witness request cannot name the requester as witness', () => {
    expect(csWasteSchema.safeParse({ locationId: id(), lotId: id(), qty: '1', reason: 'no' }).success).toBe(false);
    expect(csWasteSchema.safeParse({ locationId: id(), lotId: id(), qty: '1', reason: 'Dropped vial' }).success).toBe(true);
    const me = id();
    expect(csWitnessRequestSchema.safeParse({ action: 'waste', locationId: id(), witnessId: me, requesterId: me }).success).toBe(false);
    expect(csWitnessRequestSchema.safeParse({ action: 'waste', locationId: id(), witnessId: id(), requesterId: me }).success).toBe(true);
  });

  it('a count needs a quantity for every line, zero or more', () => {
    const lot = id();
    expect(csCountSchema.safeParse({ locationId: id(), lines: [{ lotId: lot, counted: '0' }] }).success).toBe(true);
    expect(csCountSchema.safeParse({ locationId: id(), lines: [{ lotId: lot, counted: '-1' }] }).success).toBe(false);
    expect(csCountSchema.safeParse({ locationId: id(), lines: [] }).success).toBe(false);
    expect(csCountSchema.safeParse({ locationId: id(), lines: [{ lotId: lot, counted: '1' }, { lotId: lot, counted: '1' }] }).success).toBe(false);
  });

  it('resolving needs 10 characters; an adjustment may be negative or positive but not zero', () => {
    const base = { id: id(), note: 'Recounted with the officer; vial returned' };
    expect(csDiscrepancyResolveSchema.safeParse({ ...base }).success).toBe(true);
    expect(csDiscrepancyResolveSchema.safeParse({ ...base, adjustDelta: '-1' }).success).toBe(true);
    expect(csDiscrepancyResolveSchema.safeParse({ ...base, adjustDelta: '0' }).success).toBe(false);
    expect(csDiscrepancyResolveSchema.safeParse({ id: id(), note: 'short' }).success).toBe(false);
  });

  it('a medication needs a name, schedule and a known unit', () => {
    expect(csItemSchema.safeParse({ name: 'Morphine 10 mg/mL', schedule: 'II', unit: 'mL' }).success).toBe(true);
    expect(csItemSchema.safeParse({ name: '', schedule: 'II', unit: 'mL' }).success).toBe(false);
    expect(csItemSchema.safeParse({ name: 'X', schedule: 'II', unit: 'gram' }).success).toBe(false);
  });
});
