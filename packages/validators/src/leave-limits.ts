import { z } from 'zod';
import { labelSchema, optionalUuid } from './common';

/** A cap on members on approved leave at once; blank station/shift/type mean "any". */
export const leaveLimitSchema = z
  .object({
    label: labelSchema,
    orgUnitId: optionalUuid,
    shiftId: optionalUuid,
    leaveTypeId: optionalUuid,
    maxConcurrent: z.preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
      z
        .number('Enter how many members may be on leave at once')
        .int('Use a whole number')
        .min(0, 'Use 0 or more')
        .max(1000, 'That is too many'),
    ),
    effectiveFrom: z.iso.date('Choose the date the limit starts'),
  })
  .transform((v) => ({ ...v, scopeKind: v.orgUnitId ? ('org_unit' as const) : ('department' as const) }));

export const overrideReasonSchema = z.string().trim().min(5, 'Explain the override (at least 5 characters)').max(300);
