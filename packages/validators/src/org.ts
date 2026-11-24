import { z } from 'zod';
import { keySchema, labelSchema, optionalUuid } from './common';

export const orgUnitSchema = z.object({
  name: labelSchema,
  typeId: z.uuid(),
  parentId: optionalUuid,
  code: z.string().trim().max(20).optional().transform((v) => v || null),
});

export const rankSchema = z.object({
  key: keySchema,
  label: labelSchema,
  sort: z.coerce.number().int().min(1).max(999),
});

export const shiftSchema = z.object({
  key: keySchema,
  label: labelSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #dc2626'),
});
