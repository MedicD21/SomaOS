import { z } from 'zod';

export const FORM_FIELD_TYPES = ['text', 'long_text', 'number', 'integer', 'boolean', 'date', 'select', 'multi_select', 'email', 'phone'] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export type FormField = {
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: { value: string; label: string }[];
  show_if?: { field: string; equals: string | number | boolean } | null;
};

const checkbox = z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean());
const blankToNull = <T extends z.ZodType>(s: T) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), s.nullable()).optional().transform((v) => v ?? null);

const KEY = /^[a-z][a-z0-9_]{0,39}$/;

export const formFieldSchema = z.object({
  key: z.string().regex(KEY, 'Use lowercase letters, digits and underscores'),
  label: z.string().trim().min(1, 'Enter a label').max(200),
  type: z.enum(FORM_FIELD_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.object({ value: z.string().trim().min(1), label: z.string().trim().min(1) })).optional(),
  show_if: z.object({ field: z.string(), equals: z.union([z.string(), z.number(), z.boolean()]) }).nullish(),
});

/** 1-200 fields, unique keys, options on select types, and show_if only on an earlier field. */
export const formFieldsSchema = z
  .array(formFieldSchema)
  .min(1, 'Add at least one field')
  .max(200, 'A form can have at most 200 fields')
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    fields.forEach((f, i) => {
      if (seen.has(f.key)) ctx.addIssue({ code: 'custom', path: [i, 'key'], message: `Two fields use the key "${f.key}"` });
      if ((f.type === 'select' || f.type === 'multi_select') && (!f.options || f.options.length === 0)) {
        ctx.addIssue({ code: 'custom', path: [i, 'options'], message: `${f.label} needs at least one option` });
      }
      if (f.show_if && !seen.has(f.show_if.field)) {
        ctx.addIssue({ code: 'custom', path: [i, 'show_if'], message: `${f.label} can only depend on a field above it` });
      }
      seen.add(f.key);
    });
  });

export const formDefinitionSchema = z
  .object({
    key: z.string().regex(KEY, 'Use lowercase letters, digits and underscores'),
    label: z.string().trim().min(1, 'Enter a form name').max(200),
    description: blankToNull(z.string().trim().max(1000)),
    fields: formFieldsSchema,
    requiresSignature: checkbox,
    signatureStatement: blankToNull(z.string().trim().max(500)),
    approval: z.enum(['none', 'officer']),
  })
  .refine((v) => !v.requiresSignature || (v.signatureStatement ?? '').length >= 10, {
    message: 'Write the statement the signer agrees to (at least 10 characters)',
    path: ['signatureStatement'],
  });

/** Is a field shown given the answers so far? */
export function isFieldVisible(field: FormField, answers: Record<string, unknown>): boolean {
  if (!field.show_if) return true;
  return answers[field.show_if.field] === field.show_if.equals;
}

/**
 * Turns submitted form values (strings, or lists for multi-selects) into typed answers: numbers parsed, yes/no as booleans,
 * blanks omitted, and fields hidden by show_if dropped. The database re-validates everything.
 */
export function coerceAnswers(fields: FormField[], raw: Record<string, string | string[] | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const value = raw[f.key];
    if (f.type === 'multi_select') {
      const list = (Array.isArray(value) ? value : value ? [value] : []).filter((v) => v !== '');
      if (list.length > 0) out[f.key] = list;
      continue;
    }
    const s = Array.isArray(value) ? value[0] : value;
    if (f.type === 'boolean') {
      if (s === 'true' || s === 'yes' || s === 'on') out[f.key] = true;
      else if (s === 'false' || s === 'no') out[f.key] = false;
      continue;
    }
    if (s === undefined || s.trim() === '') continue;
    if (f.type === 'number' || f.type === 'integer') {
      const n = Number(s);
      out[f.key] = Number.isFinite(n) ? n : s;   // a non-number is left as text so the database says so
      continue;
    }
    out[f.key] = f.type === 'long_text' ? s : s.trim();
  }
  for (const f of fields) {
    if (!isFieldVisible(f, out)) delete out[f.key];
  }
  return out;
}

export const submitFormSchema = z.object({
  definitionId: z.uuid(),
  correctsId: blankToNull(z.uuid()),
  signatureMethod: blankToNull(z.enum(['typed', 'drawn'])),
  typedName: blankToNull(z.string().trim().max(200)),
  signatureImage: blankToNull(z.string().max(400_000)),
});

export const decideFormSchema = z.object({
  submissionId: z.uuid(),
  decision: z.enum(['approved', 'rejected', 'returned']),
  note: blankToNull(z.string().trim().max(500)),
});

export const voidFormSchema = z.object({
  submissionId: z.uuid(),
  reason: z.string().trim().min(5, 'Explain why it is void (at least 5 characters)').max(300),
});
