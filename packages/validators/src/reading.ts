import { z } from 'zod';

const checkbox = z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean());
const blankToNull = <T extends z.ZodType>(s: T) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), s.nullable()).optional().transform((v) => v ?? null);

/** Who must read it: everyone, or people in chosen units (and their sub-units), or holders of chosen roles. */
export const assignReadingSchema = z
  .object({
    versionId: z.uuid(),
    everyone: checkbox,
    orgUnitIds: z.array(z.uuid()).max(100).default([]),
    roleIds: z.array(z.uuid()).max(100).default([]),
    dueOn: blankToNull(z.iso.date('Use a valid date')),
    statement: blankToNull(z.string().trim().min(5, 'Use at least 5 characters').max(500, 'Keep the statement under 500 characters')),
    requireTypedName: checkbox,
  })
  .refine((v) => v.everyone || v.orgUnitIds.length > 0 || v.roleIds.length > 0, { message: 'Choose who should read it', path: ['everyone'] })
  .transform((v) => ({
    versionId: v.versionId,
    audience: v.everyone ? { all: true } : { org_unit_ids: v.orgUnitIds, role_ids: v.roleIds },
    dueOn: v.dueOn,
    statement: v.statement,
    requireTypedName: v.requireTypedName,
  }));

export const acknowledgeSchema = z.object({
  readingId: z.uuid(),
  typedName: blankToNull(z.string().trim().max(200)),
});
