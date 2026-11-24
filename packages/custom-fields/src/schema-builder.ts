import { z } from 'zod';

export const CUSTOM_FIELD_TYPES = [
  'text', 'long_text', 'number', 'integer', 'boolean', 'date', 'select', 'multi_select', 'email', 'phone',
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export type CustomFieldOption = { value: string; label: string };

export type CustomFieldDef = {
  key: string;
  label: string;
  type: CustomFieldType;
  options?: CustomFieldOption[];
  required: boolean;
  archived: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function optionEnum(def: CustomFieldDef): z.ZodType<string> {
  const values = (def.options ?? []).map((o) => o.value);
  return z.string().refine((v) => values.includes(v), { message: `Must be one of: ${values.join(', ')}` });
}

function fieldSchema(def: CustomFieldDef): z.ZodType {
  switch (def.type) {
    case 'text':
      return z.string().trim().min(def.required ? 1 : 0).max(500);
    case 'long_text':
      return z.string().max(10_000);
    case 'number':
      return z.number().finite();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    case 'date':
      return z
        .string()
        .refine((v) => ISO_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Use a valid YYYY-MM-DD date');
    case 'select':
      return optionEnum(def);
    case 'multi_select':
      return z.array(optionEnum(def));
    case 'email':
      return z.email();
    case 'phone':
      return z.string().regex(/^[+\d][\d\s().-]{6,24}$/, 'Invalid phone number');
  }
}

/**
 * Zod schema for an entity's `custom` JSONB built from the tenant's field registry.
 * Archived fields are accepted (to preserve history) but never required.
 */
export function buildCustomFieldSchema(defs: CustomFieldDef[]): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};
  for (const def of defs) {
    const base = fieldSchema(def);
    shape[def.key] = def.required && !def.archived ? base : base.optional().nullable();
  }
  return z.strictObject(shape);
}
