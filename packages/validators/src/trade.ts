import { z } from 'zod';

export const proposeTradeSchema = z.object({
  mineId: z.uuid('Choose one of your shifts'),
  theirsId: z.uuid('Choose the shift you want'),
  note: z.string().trim().max(300, 'Keep the note under 300 characters').optional().transform((v) => v || null),
});

export const respondTradeSchema = z.object({ id: z.uuid(), accept: z.boolean() });

export const decideTradeSchema = z.object({
  id: z.uuid(),
  approve: z.boolean(),
  note: z.string().trim().max(300).optional().transform((v) => v || null),
  overrideReason: z.string().trim().min(5, 'Explain the override (at least 5 characters)').max(300).optional(),
});
