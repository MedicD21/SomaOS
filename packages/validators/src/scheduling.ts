import { z } from 'zod';
import { keySchema, labelSchema, optionalUuid } from './common';

const isoDate = z.iso.date();
const isoDateTime = z.iso.datetime({ offset: true });

export const ASSIGNMENT_TYPES = [
  'regular',
  'overtime',
  'trade',
  'holdover',
  'callback',
  'acting',
  'training',
  'detail',
  'kelly',
] as const;
export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

/** Mirrors `ShiftPattern` in @soma/schedule-engine. */
export const shiftPatternSchema = z.object({
  cycle: z
    .array(z.enum(['on', 'off']))
    .min(1)
    .max(56)
    .refine((c) => c.includes('on'), 'Cycle needs at least one "on" day'),
  shiftStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM'),
  shiftHours: z.coerce.number().min(1).max(48),
  anchorDate: isoDate,
  platoons: z.record(z.string(), z.coerce.number().int().min(0).max(55)),
  kelly: z.object({ everyNthShift: z.coerce.number().int().min(2).max(30) }).optional(),
});
export type ShiftPatternInput = z.infer<typeof shiftPatternSchema>;

/** Mirrors `Validity` in @soma/schedule-engine. */
export const validitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('months'), months: z.coerce.number().int().min(1).max(240) }),
  z
    .object({
      kind: z.literal('fixed_cycle'),
      month: z.coerce.number().int().min(1).max(12),
      day: z.coerce.number().int().min(1).max(31),
      years: z.coerce.number().int().min(1).max(10),
    })
    .refine((v) => v.day <= new Date(Date.UTC(2024, v.month, 0)).getUTCDate(), {
      message: 'Impossible month/day',
      path: ['day'],
    }),
]);

export const credentialTypeSchema = z.object({
  key: keySchema,
  label: labelSchema,
  validity: validitySchema,
  warnDays: z.array(z.coerce.number().int().min(1).max(365)).default([90, 60, 30, 7]),
});
export type CredentialTypeInput = z.infer<typeof credentialTypeSchema>;

export const seatSchema = z.object({
  orgUnitId: z.uuid(),
  label: labelSchema,
  sort: z.coerce.number().int().default(0),
  required: z.boolean(),
  minRankId: optionalUuid.transform((v) => v ?? undefined),
  actingAllowed: z.boolean(),
  requirementGroups: z.array(z.array(z.uuid())),
});
export type SeatInput = z.infer<typeof seatSchema>;

export const assignSchema = z.object({
  seatId: z.uuid(),
  memberId: z.uuid(),
  start: isoDateTime,
  end: isoDateTime,
  type: z.enum(ASSIGNMENT_TYPES),
  overrideReason: z.string().trim().min(5).max(500).optional(),
});
export type AssignInput = z.infer<typeof assignSchema>;

export const memberCredentialSchema = z.object({
  memberId: z.uuid(),
  typeId: z.uuid(),
  issuedOn: isoDate,
  number: z.string().trim().max(60).optional(),
});
export type MemberCredentialInput = z.infer<typeof memberCredentialSchema>;

export const standingSeatSchema = z.object({
  memberId: z.uuid(),
  seatId: z.uuid(),
  platoonShiftId: z.uuid(),
  kellyGroup: z.coerce.number().int().min(0).max(29).optional(),
  effectiveFrom: isoDate,
});
export type StandingSeatInput = z.infer<typeof standingSeatSchema>;
