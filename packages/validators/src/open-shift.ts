import { z } from 'zod';

const reason = (what: string) =>
  z.string().trim().min(5, `Explain ${what} (at least 5 characters)`).max(300, 'Keep this under 300 characters');

export const postOpenShiftSchema = z.object({
  seatId: z.uuid('Choose a seat'),
  type: z.enum(['regular', 'overtime']),
  reason: reason('why this shift is open'),
});

export const cancelOpenShiftSchema = z.object({ id: z.uuid(), reason: reason('why it is cancelled') });

export const claimOpenShiftSchema = z.object({
  id: z.uuid(),
  note: z.string().trim().max(300, 'Keep the note under 300 characters').optional().transform((v) => v || null),
});

export const decideClaimSchema = z.object({
  id: z.uuid(),
  approve: z.boolean(),
  note: z.string().trim().max(300).optional().transform((v) => v || null),
  overrideReason: z.string().trim().min(5, 'Explain the override (at least 5 characters)').max(300).optional(),
});
