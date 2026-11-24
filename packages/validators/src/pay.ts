import { z } from 'zod';
import { keySchema, labelSchema } from './common';
import { accrualPolicySchema } from './leave';
import { keyFromLabel } from './people';

const isoDate = z.iso.date();
const multiplier = z.number().min(1).max(5);

export const PAY_WORK_TYPES = ['regular', 'overtime', 'trade', 'holdover', 'callback', 'acting', 'training', 'detail'] as const;

const assignmentPay = z.object({
  code: z.string().trim().min(1).max(40),
  multiplier: z.number().min(0).max(5),
  countsTowardFlsa: z.boolean().optional(),
  minimumHours: z.number().min(0).max(48).optional(),
});

/** Mirrors `PayRules` in @soma/schedule-engine. */
export const payRulesSchema = z
  .object({
    payPeriod: accrualPolicySchema.shape.period,
    workPeriod: z.object({
      days: z.number().int().min(1).max(366),
      anchor: isoDate,
      threshold: z.number().positive().max(10_000),
      multiplier,
      code: z.string().trim().min(1).max(40),
    }),
    overtimeCombination: z.enum(['highest', 'stack']),
    assignments: z.object(Object.fromEntries(PAY_WORK_TYPES.map((t) => [t, assignmentPay])) as Record<(typeof PAY_WORK_TYPES)[number], typeof assignmentPay>),
    compTime: z.object({
      mode: z.enum(['never', 'always', 'member_choice']),
      multiplier,
      bankKey: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).nullable(),
    }),
  })
  .superRefine((r, ctx) => {
    if (r.compTime.mode !== 'never' && !r.compTime.bankKey) {
      ctx.addIssue({ code: 'custom', path: ['compTime', 'bankKey'], message: 'Choose the leave bank comp time is credited to' });
    }
  });
export type PayRulesInput = z.infer<typeof payRulesSchema>;

export function parsePayRulesJson(text: string): { ok: true; rules: PayRulesInput } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `That is not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const r = payRulesSchema.safeParse(raw);
  if (r.success) return { ok: true, rules: r.data };
  const first = r.error.issues[0]!;
  const path = first.path.join('.');
  return { ok: false, error: path ? `${path}: ${first.message}` : first.message };
}

const checkbox = z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean());
const blankToNull = <T extends z.ZodType>(s: T) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), s.nullable()).optional().transform((v) => v ?? null);

export const payCodeSchema = z
  .object({
    label: labelSchema,
    key: keySchema.optional().or(z.literal('')),
    kind: z.enum(['regular', 'overtime', 'premium', 'leave', 'other']),
    multiplier: z.coerce.number().min(0).max(5),
    countsTowardFlsa: checkbox,
    exportCode: blankToNull(z.string().trim().max(40)),
  })
  .transform((v) => ({ ...v, key: v.key || keyFromLabel(v.label) }));

export const employeeGroupSchema = z
  .object({ label: labelSchema, key: keySchema.optional().or(z.literal('')) })
  .transform((v) => ({ label: v.label, key: v.key || keyFromLabel(v.label) }));

export const payRateSchema = z.object({
  memberId: z.uuid(),
  hourlyRate: z.coerce
    .number()
    .gt(0, 'Enter a rate above zero')
    .max(1000, 'That rate is too high')
    .refine((n) => Math.abs(n * 10_000 - Math.round(n * 10_000)) < 1e-6, 'Use at most 4 decimal places'),
  effectiveFrom: isoDate,
  note: blankToNull(z.string().trim().max(200)),
});
