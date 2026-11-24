import { z } from 'zod';
import { isPermission } from '@soma/auth';
import { keySchema, labelSchema, optionalUuid } from './common';

const blankToNull = <T extends z.ZodType>(s: T) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), s.nullable()).optional().transform((v) => v ?? null);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const EMPLOYMENT_TYPES = ['career_full_time', 'career_part_time', 'volunteer', 'per_diem', 'other'] as const;

export const memberSchema = z.object({
  firstName: labelSchema,
  lastName: labelSchema,
  preferredName: blankToNull(z.string().trim().max(80)),
  employeeNumber: blankToNull(z.string().trim().max(40)),
  email: blankToNull(z.email()),
  phone: blankToNull(z.string().trim().max(30)),
  rankId: optionalUuid,
  employmentType: z.enum(EMPLOYMENT_TYPES),
  hireDate: blankToNull(isoDate),
  seniorityDate: blankToNull(isoDate),
});
export type MemberInput = z.infer<typeof memberSchema>;

export const assignmentSchema = z.object({
  orgUnitId: z.uuid(),
  shiftId: optionalUuid,
  effectiveFrom: isoDate,
});

/** "Shift Scheduler" → "shift_scheduler"; keys must start with a letter. */
export function keyFromLabel(label: string): string {
  const k = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return /^[a-z]/.test(k) ? k : `r_${k}`.slice(0, 40);
}

export const roleSchema = z.object({
  label: labelSchema,
  key: keySchema,
  permissions: z.array(z.string().refine(isPermission, 'Unknown permission')),
});

export const grantSchema = z
  .object({
    memberId: z.uuid(),
    roleId: z.uuid(),
    scopeKind: z.enum(['self', 'org_unit', 'department']),
    scopeOrgUnitId: optionalUuid,
    scopeShiftId: optionalUuid,
    validFrom: blankToNull(isoDate),
    validTo: blankToNull(isoDate),
    reason: blankToNull(z.string().trim().max(200)),
  })
  .transform((g) => ({ ...g, scopeOrgUnitId: g.scopeKind === 'org_unit' ? g.scopeOrgUnitId : null }))
  .superRefine((g, ctx) => {
    if (g.scopeKind === 'org_unit' && !g.scopeOrgUnitId)
      ctx.addIssue({ code: 'custom', path: ['scopeOrgUnitId'], message: 'Choose an org unit' });
    if (g.validFrom && g.validTo && g.validTo <= g.validFrom)
      ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'End must be after start' });
  });

const CUSTOM_TYPES = ['text', 'long_text', 'number', 'integer', 'boolean', 'date', 'select', 'multi_select', 'email', 'phone'] as const;

/** Options entered one per line as "value:label" or "label". */
function parseOptions(raw: string): { value: string; label: string }[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [value, ...rest] = l.split(':');
      return { value: value!.trim(), label: (rest.join(':').trim() || value!.trim()) };
    });
}

export const customFieldDefSchema = z
  .object({
    label: labelSchema,
    key: z.string().optional(),
    type: z.enum(CUSTOM_TYPES),
    options: z.string().optional(),
    required: z.coerce.boolean().optional(),
    sensitivity: blankToNull(z.enum(['PHI', 'HR', 'MEDICAL', 'CJI'])),
  })
  .transform((d) => ({
    label: d.label,
    key: d.key?.trim() || keyFromLabel(d.label),
    type: d.type,
    options: d.type === 'select' || d.type === 'multi_select' ? parseOptions(d.options ?? '') : null,
    required: d.required ?? false,
    sensitivity: d.sensitivity ?? null,
  }))
  .superRefine((d, ctx) => {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(d.key)) ctx.addIssue({ code: 'custom', path: ['key'], message: 'Invalid key' });
    if (d.options && d.options.length === 0) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least one option' });
  });
