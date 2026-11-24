import { z } from 'zod';
import { PAY_WORK_TYPES } from './pay';

const reason = (what: string) =>
  z.string().trim().min(5, `Explain ${what} (at least 5 characters)`).max(300, 'Keep this under 300 characters');

/** Time worked that is not (or differs from) the schedule, recorded by an officer or payroll. */
export const timeEntrySchema = z.object({
  memberId: z.uuid('Choose a member'),
  workDate: z.iso.date('Choose the date worked'),
  hours: z.coerce
    .number('Enter the hours worked')
    .gt(0, 'Enter more than 0 hours')
    .max(48, 'At most 48 hours per entry')
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Use at most 2 decimal places'),
  type: z.enum(PAY_WORK_TYPES),
  reason: reason('the time'),
});

export const voidTimeEntrySchema = z.object({ id: z.uuid(), reason: reason('why the entry is void') });

export const closePeriodSchema = z.object({ start: z.iso.date() });

export const reopenPeriodSchema = z.object({ id: z.uuid(), reason: reason('why the period is reopened') });
