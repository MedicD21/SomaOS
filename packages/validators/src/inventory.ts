import { z } from 'zod';
import { optionalUuid } from './common';

export const STOCK_CATEGORIES = ['medical', 'station_supply', 'ppe', 'other'] as const;
export const LOCATION_KINDS = ['storeroom', 'station', 'apparatus', 'compartment', 'container'] as const;

const threeDecimals = (n: number) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;

const qty = z.coerce
  .number('Enter a quantity')
  .gt(0, 'Enter a quantity above zero')
  .max(1_000_000, 'That quantity is too large')
  .refine(threeDecimals, 'Use at most 3 decimal places');

export const itemSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120),
  sku: z.string().trim().max(80).optional().transform((v) => v || null),
  category: z.enum(STOCK_CATEGORIES),
  unit: z.string().trim().min(1, 'Enter a unit').max(30),
});

export const stockLocationSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120),
  kind: z.enum(LOCATION_KINDS),
  parentId: optionalUuid,
  orgUnitId: optionalUuid,
});

const where = { locationId: z.uuid('Choose a location'), itemId: z.uuid('Choose an item') };

export const receiveStockSchema = z.object({ ...where, quantity: qty, reference: z.string().trim().max(200).optional().transform((v) => v || null) });
export const useStockSchema = z.object({ ...where, quantity: qty, reason: z.string().trim().max(200).optional().transform((v) => v || null) });
export const adjustStockSchema = z.object({
  ...where,
  delta: z.coerce.number('Enter the change').refine((n) => n !== 0, 'Enter a change other than zero').refine(threeDecimals, 'Use at most 3 decimal places'),
  reason: z.string().trim().min(5, 'Explain the adjustment (at least 5 characters)').max(200),
});
export const transferStockSchema = z
  .object({ fromId: z.uuid('Choose where from'), toId: z.uuid('Choose where to'), itemId: z.uuid('Choose an item'), quantity: qty, note: z.string().trim().max(200).optional().transform((v) => v || null) })
  .refine((v) => v.fromId !== v.toId, { path: ['toId'], message: 'Choose two different locations' });
export const parSchema = z
  .object({ ...where, par: z.coerce.number('Enter the par level').min(0), min: z.coerce.number().min(0).default(0) })
  .refine((v) => v.min <= v.par, { path: ['min'], message: 'The minimum cannot exceed par' });
