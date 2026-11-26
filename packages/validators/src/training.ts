import { z } from 'zod';
import { keySchema, labelSchema } from './common';
import { keyFromLabel } from './people';

const checkbox = z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean());
const blankToNull = <T extends z.ZodType>(s: T) =>
  z.preprocess((v) => (v === '' || v === undefined || v === null ? null : v), s.nullable()).optional().transform((v) => v ?? null);
const reason = (what: string) =>
  z.string().trim().min(5, `Explain ${what} (at least 5 characters)`).max(300, 'Keep this under 300 characters');
const hours = (max: number, what = 'Hours') =>
  z.coerce
    .number(`Enter ${what.toLowerCase()}`)
    .gt(0, `${what} must be more than 0`)
    .max(max, `${what} can be at most ${max}`)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Use at most 2 decimal places');

export const TRAINING_ATTENDANCE = ['attended', 'partial', 'absent', 'excused'] as const;
export const TRAINING_AUDIENCE_KINDS = ['role', 'rank', 'shift', 'org_unit', 'member'] as const;
export const TRAINING_WINDOW_KINDS = ['calendar_year', 'rolling_months', 'fixed_cycle'] as const;

export const trainingCategorySchema = z
  .object({ label: labelSchema, key: keySchema.optional().or(z.literal('')), externalCode: blankToNull(z.string().trim().max(60)) })
  .transform((v) => ({ ...v, key: v.key || keyFromLabel(v.label) }));

export const trainingCourseSchema = z
  .object({
    label: labelSchema,
    key: keySchema.optional().or(z.literal('')),
    categoryId: z.uuid('Choose a category'),
    defaultHours: hours(999, 'Default hours'),
    credentialTypeId: blankToNull(z.uuid()),
    minHoursPct: z.coerce.number().min(0, 'Use 0 to 100').max(100, 'Use 0 to 100').default(100),
    description: blankToNull(z.string().trim().max(1000)),
  })
  .transform((v) => ({ ...v, key: v.key || keyFromLabel(v.label) }));

/** Form fields for a requirement window; turned into the stored JSON shape. */
export const trainingRequirementSchema = z
  .object({
    label: labelSchema,
    categoryId: z.uuid('Choose a category'),
    rankId: blankToNull(z.uuid()),
    roleId: blankToNull(z.uuid()),
    requiredHours: hours(9999, 'Required hours'),
    windowKind: z.enum(TRAINING_WINDOW_KINDS),
    months: blankToNull(z.coerce.number().int().min(1, 'Use 1 to 120').max(120, 'Use 1 to 120')),
    month: blankToNull(z.coerce.number().int().min(1, 'Use 1 to 12').max(12, 'Use 1 to 12')),
    day: blankToNull(z.coerce.number().int().min(1, 'Use 1 to 31').max(31, 'Use 1 to 31')),
    years: blankToNull(z.coerce.number().int().min(1, 'Use 1 to 10').max(10, 'Use 1 to 10')),
    effectiveFrom: z.iso.date('Choose the date it takes effect'),
  })
  .superRefine((v, ctx) => {
    const need = (field: 'months' | 'month' | 'day' | 'years', label: string) => {
      if (v[field] === null) ctx.addIssue({ code: 'custom', path: [field], message: `Enter ${label}` });
    };
    if (v.windowKind === 'rolling_months') need('months', 'the number of months');
    if (v.windowKind === 'fixed_cycle') {
      need('month', 'the month');
      need('day', 'the day');
      need('years', 'the years per cycle');
    }
  })
  .transform((v) => ({
    label: v.label,
    categoryId: v.categoryId,
    rankId: v.rankId,
    roleId: v.roleId,
    requiredHours: v.requiredHours,
    effectiveFrom: v.effectiveFrom,
    window:
      v.windowKind === 'calendar_year'
        ? { kind: 'calendar_year' as const }
        : v.windowKind === 'rolling_months'
          ? { kind: 'rolling_months' as const, months: v.months! }
          : { kind: 'fixed_cycle' as const, month: v.month!, day: v.day!, years: v.years! },
  }));

const audienceEntry = z.object({ kind: z.enum(TRAINING_AUDIENCE_KINDS), refId: z.uuid() });

/** A session as entered on the form: local date and start time in the department's zone, plus a length in hours. */
export const trainingSessionSchema = z.object({
  courseId: z.uuid('Choose a course'),
  title: z.string().trim().min(1, 'Enter a title').max(160, 'Keep the title under 160 characters'),
  date: z.iso.date('Choose the date'),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a start time as HH:MM'),
  durationHours: hours(48, 'Length in hours'),
  orgUnitId: blankToNull(z.uuid()),
  location: blankToNull(z.string().trim().max(200)),
  instructorId: blankToNull(z.uuid()),
  capacity: blankToNull(z.coerce.number().int().min(1, 'Capacity must be at least 1').max(5000)),
  assignedOnly: checkbox,
  notes: blankToNull(z.string().trim().max(1000)),
  audience: z.array(audienceEntry).max(50).default([]),
});

export const trainingAttendanceSchema = z
  .object({
    enrollmentId: z.uuid(),
    status: z.enum(TRAINING_ATTENDANCE),
    hours: blankToNull(z.coerce.number().gt(0, 'Hours must be more than 0').max(48, 'Hours can be at most 48')),
    note: blankToNull(z.string().trim().max(300)),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'partial') {
      if (v.hours === null) ctx.addIssue({ code: 'custom', path: ['hours'], message: 'Enter the hours attended' });
      if ((v.note ?? '').length < 5) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Add a note explaining the partial attendance (at least 5 characters)' });
    }
  });

export const trainingCancelSchema = z.object({ id: z.uuid(), reason: reason('why the session is cancelled') });
export const trainingArchiveSchema = z.object({ id: z.uuid(), reason: reason('why it is archived') });
export const trainingSessionIdSchema = z.object({ id: z.uuid() });
