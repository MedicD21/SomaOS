import { z } from 'zod';

const groupKey = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use lowercase letters, digits and _');
const reason = (what: string) =>
  z.string().trim().min(5, `Explain ${what} (at least 5 characters)`).max(500, 'Keep this under 500 characters');

/** Mirrors `StaffingRules` in @soma/schedule-engine. Group references must name a defined group. */
export const staffingRulesSchema = z
  .object({
    groups: z
      .array(
        z.object({
          key: groupKey,
          label: z.string().trim().min(1, 'Name the group').max(40),
          credentialKeys: z.array(z.string().min(1).max(60)).min(1, 'Choose at least one credential type'),
        }),
      )
      .max(10),
    departmentMinimums: z.array(z.object({ group: groupKey, min: z.coerce.number().int().min(0).max(10000) })).max(10),
    unitRules: z
      .array(z.object({ group: groupKey, unitTypeKey: z.string().min(1).max(60), min: z.coerce.number().int().min(1).max(50) }))
      .max(10),
  })
  .superRefine((r, ctx) => {
    const keys = new Set(r.groups.map((g) => g.key));
    if (keys.size !== r.groups.length) ctx.addIssue({ code: 'custom', path: ['groups'], message: 'Group keys must be unique' });
    r.departmentMinimums.forEach((m, i) => {
      if (!keys.has(m.group)) ctx.addIssue({ code: 'custom', path: ['departmentMinimums', i, 'group'], message: 'Unknown group' });
    });
    r.unitRules.forEach((m, i) => {
      if (!keys.has(m.group)) ctx.addIssue({ code: 'custom', path: ['unitRules', i, 'group'], message: 'Unknown group' });
    });
  });

export const createMandateListSchema = z.object({ name: z.string().trim().min(2, 'Name the list (2 to 80 characters)').max(80) });

export const mandateMemberSchema = z.object({ listId: z.uuid(), memberId: z.uuid('Choose a member') });

export const mandateRemoveSchema = mandateMemberSchema.extend({ reason: reason('why they are removed') });

export const mandateReorderSchema = z.object({
  listId: z.uuid(),
  order: z.array(z.uuid()).min(1).max(1000),
  reason: reason('the new order'),
});

export const mandateExemptSchema = mandateMemberSchema.extend({
  reason: reason('the exemption'),
  until: z.union([z.iso.date(), z.literal('')]).transform((v) => v || null),
});

export const mandateSkipSchema = mandateMemberSchema.extend({ reason: reason('why they are skipped'), date: z.iso.date() });

export const mandateRecordSchema = mandateMemberSchema.extend({
  seatId: z.uuid('Choose a seat'),
  date: z.iso.date(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM'),
  hours: z.coerce.number().int('Whole hours').min(1, 'At least 1 hour').max(48, 'At most 48 hours'),
  reason: z.string().trim().max(500).optional().transform((v) => v || null),
  overrideReason: z.string().trim().min(5, 'Explain the override (at least 5 characters)').max(500).optional(),
});
