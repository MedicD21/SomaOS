import { z } from 'zod';

export const CS_UNITS = ['mg', 'mcg', 'g', 'mL', 'each'] as const;
export const CS_LOCATION_KINDS = ['vault', 'station', 'unit', 'drug_box', 'member'] as const;
export const CS_WITNESSED_ACTIONS = ['waste', 'adjust', 'transfer', 'return', 'seal_break', 'count'] as const;

const blankToNull = <T extends z.ZodType>(s: T) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), s.nullable()).optional().transform((v) => v ?? null);

/** A quantity above zero with at most three decimals, in the item's unit. */
const qty = z.coerce
  .number('Enter a quantity')
  .gt(0, 'Enter a quantity above zero')
  .max(999_999, 'That quantity is too large')
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'Use at most 3 decimal places');

const counted = z.coerce
  .number('Enter a quantity')
  .min(0, 'Enter zero or more')
  .max(999_999, 'That quantity is too large')
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'Use at most 3 decimal places');

const reason = (what: string, min = 5) =>
  z.string().trim().min(min, `Explain ${what} (at least ${min} characters)`).max(500, 'Keep this under 500 characters');

/** Run or incident number only: no patient identifiers. */
const reference = z.string().trim().max(200, 'Keep the reference under 200 characters');

export const csItemSchema = z.object({
  name: z.string().trim().min(1, 'Enter the medication name').max(120),
  schedule: z.string().trim().min(1, 'Enter the schedule, for example II').max(12),
  ndc: blankToNull(z.string().trim().max(20)),
  unit: z.enum(CS_UNITS, 'Choose a unit'),
  note: blankToNull(z.string().trim().max(200)),
});

export const csLotSchema = z.object({
  itemId: z.uuid('Choose a medication'),
  lotNo: z.string().trim().min(1, 'Enter the lot number').max(60),
  expiresOn: z.iso.date('Enter the expiration date'),
});

export const csLocationSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120),
  kind: z.enum(CS_LOCATION_KINDS, 'Choose a kind'),
  orgUnitId: z.uuid('Choose a unit'),
  memberId: blankToNull(z.uuid()),
});

export const csRecallSchema = z.object({ lotId: z.uuid(), note: reason('the recall') });

export const csSealSchema = z.object({ locationId: z.uuid(), sealNo: z.string().trim().min(1, 'Enter the seal number').max(60) });

export const csSealBreakSchema = z.object({
  locationId: z.uuid(),
  reason: reason('why the seal is broken'),
  newSealNo: z.string().trim().min(1, 'Enter the new seal number').max(60),
});

export const csReceiveSchema = z.object({
  locationId: z.uuid('Choose a location'),
  lotId: z.uuid('Choose a lot'),
  qty,
  reference: blankToNull(reference),
});

export const csAdministerSchema = z.object({
  locationId: z.uuid('Choose a location'),
  lotId: z.uuid('Choose a lot'),
  qty,
  reference: reference.min(3, 'Enter the incident or run number (at least 3 characters)'),
});

export const csMoveSchema = z
  .object({
    fromId: z.uuid('Choose where it comes from'),
    toId: z.uuid('Choose where it goes'),
    lotId: z.uuid('Choose a lot'),
    qty,
    note: blankToNull(z.string().trim().max(500)),
  })
  .refine((v) => v.fromId !== v.toId, { path: ['toId'], message: 'Choose two different locations' });

export const csWasteSchema = z.object({
  locationId: z.uuid('Choose a location'),
  lotId: z.uuid('Choose a lot'),
  qty,
  reason: reason('the waste'),
});

export const csAdjustSchema = z.object({
  locationId: z.uuid(),
  lotId: z.uuid(),
  delta: z.coerce.number('Enter an amount').refine((n) => n !== 0, 'Enter a non-zero amount').refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'Use at most 3 decimal places'),
  reason: reason('the adjustment'),
});

/** Ask another member to witness; the witness can never be the member asking. */
export const csWitnessRequestSchema = z
  .object({
    action: z.enum(CS_WITNESSED_ACTIONS),
    locationId: z.uuid(),
    witnessId: z.uuid('Choose who will witness'),
    requesterId: z.uuid().optional(),
  })
  .refine((v) => !v.requesterId || v.requesterId !== v.witnessId, { path: ['witnessId'], message: 'The witness must be a different member' });

export const csCountSchema = z
  .object({
    locationId: z.uuid(),
    lines: z.array(z.object({ lotId: z.uuid(), counted })).min(1, 'Count at least one lot'),
    sealNo: blankToNull(z.string().trim().max(60)),
  })
  .refine((v) => new Set(v.lines.map((l) => l.lotId)).size === v.lines.length, { path: ['lines'], message: 'Each lot can be counted only once' });

export const csInvestigateSchema = z.object({ id: z.uuid(), note: reason('what you are looking into') });

export const csEscalateSchema = z.object({
  id: z.uuid(),
  note: reason('why this is escalated'),
  reportRef: blankToNull(z.string().trim().max(200)),
});

export const csDiscrepancyResolveSchema = z.object({
  id: z.uuid(),
  note: reason('the resolution', 10),
  adjustDelta: z
    .preprocess(
      (v) => (v === '' || v === undefined || v === null ? undefined : v),
      z.coerce.number('Enter an amount').refine((n) => n !== 0, 'Enter a non-zero amount').refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'Use at most 3 decimal places').optional(),
    )
    .optional(),
});
