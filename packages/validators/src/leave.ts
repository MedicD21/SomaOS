import { z } from 'zod';
import { keySchema, labelSchema, optionalUuid } from './common';
import { keyFromLabel } from './people';

const isoDate = z.iso.date();
const nonNegative = z.number().min(0).max(100_000);
const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const checkbox = z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean());
const blankToNull = <T extends z.ZodType>(s: T) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), s.nullable()).optional().transform((v) => v ?? null);

/** Mirrors `EarnRule` in @soma/schedule-engine. */
export const earnRuleSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('per_period'), hours: nonNegative }),
  z.object({ method: z.literal('per_hours_worked'), perHours: z.number().positive().max(100_000), earnHours: nonNegative }),
  z.object({ method: z.literal('annual_front_load'), hours: nonNegative }),
  z.object({ method: z.literal('manual') }),
]);

/** Mirrors `AccrualPolicy` in @soma/schedule-engine. */
export const accrualPolicySchema = z.object({
  period: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('monthly') }),
    z.object({ kind: z.literal('fixed_days'), days: z.number().int().min(1).max(366), anchor: isoDate }),
  ]),
  tiers: z
    .array(z.object({ fromYears: z.number().int().min(0).max(60), earn: earnRuleSchema }))
    .min(1, 'Add at least one tier')
    .superRefine((tiers, ctx) => {
      if (tiers[0]?.fromYears !== 0) ctx.addIssue({ code: 'custom', path: [0, 'fromYears'], message: 'The first tier must start at 0 years' });
      tiers.forEach((t, i) => {
        const prev = tiers[i - 1];
        if (prev && t.fromYears <= prev.fromYears) {
          ctx.addIssue({ code: 'custom', path: [i, 'fromYears'], message: 'Tiers must be in strictly increasing order of years' });
        }
      });
    }),
  cap: nonNegative.nullable(),
  waitingPeriodDays: z.number().int().min(0).max(3650),
  prorateFirstPeriod: z.boolean(),
  fractionByEmploymentType: z.record(z.string(), z.number().gt(0).max(1)),
  negativeAllowed: z.boolean(),
  carryover: z.object({
    max: nonNegative.nullable(),
    resetOn: z.string().regex(MMDD, 'Use MM-DD').nullable(),
  }),
});
export type AccrualPolicyInput = z.infer<typeof accrualPolicySchema>;

export function parseAccrualPolicyJson(
  text: string,
): { ok: true; policy: AccrualPolicyInput } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `That is not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const r = accrualPolicySchema.safeParse(raw);
  if (r.success) return { ok: true, policy: r.data };
  const first = r.error.issues[0]!;
  const path = first.path.join('.');
  return { ok: false, error: path ? `${path}: ${first.message}` : first.message };
}

const withKey = <T extends { label: string; key?: string | undefined }>(v: T) => ({
  ...v,
  key: v.key?.trim() || keyFromLabel(v.label),
});

export const bankSchema = z
  .object({ label: labelSchema, key: keySchema.optional().or(z.literal('')) })
  .transform((v) => withKey({ label: v.label, key: v.key || undefined }));

/** Who may request a leave type: any member, or only approvers and leave managers (admin, discipline, officer codes). */
export const LEAVE_AUDIENCES = ['member', 'officer'] as const;
export const leaveAudienceSchema = z.enum(LEAVE_AUDIENCES);
export type LeaveAudience = z.infer<typeof leaveAudienceSchema>;

export const leaveTypeSchema = z
  .object({
    label: labelSchema,
    key: keySchema.optional().or(z.literal('')),
    bankId: optionalUuid,
    requiresDocumentation: checkbox,
    countsAsWorked: checkbox,
    leadTimeDays: z.coerce.number().int().min(0).max(365).default(0),
    audience: z.preprocess((v) => (v === '' || v == null ? 'member' : v), leaveAudienceSchema),
  })
  .transform((v) => ({ ...withKey({ label: v.label, key: v.key || undefined }), bankId: v.bankId, requiresDocumentation: v.requiresDocumentation, countsAsWorked: v.countsAsWorked, leadTimeDays: v.leadTimeDays, audience: v.audience }));

export const leaveRequestSchema = z
  .object({
    leaveTypeId: z.uuid(),
    startDate: isoDate,
    endDate: isoDate,
    reason: blankToNull(z.string().trim().max(300)),
  })
  .refine((v) => v.endDate >= v.startDate, { path: ['endDate'], message: 'End date must be on or after the start date' });

export const adjustmentSchema = z.object({
  memberId: z.uuid(),
  bankId: z.uuid(),
  hours: z.coerce
    .number()
    .refine((n) => n !== 0, 'Enter a non-zero number of hours')
    .refine((n) => Math.abs(n) <= 2000, 'Too large'),
  note: z.string().trim().min(5, 'Explain the adjustment (at least 5 characters)').max(200),
});

export const decisionSchema = z.object({
  requestId: z.uuid(),
  approve: z.boolean(),
  note: z.string().trim().max(300).optional().transform((v) => v || null),
});
