import { z } from 'zod';
import { timezoneSchema } from './common';

/** Labels a department may rename. Singular and plural forms are separate keys. */
export const TERMINOLOGY_KEYS = [
  'shift', 'shifts', 'station', 'stations', 'unit', 'units', 'member', 'members', 'battalion', 'battalions',
] as const;
export type TerminologyKey = (typeof TERMINOLOGY_KEYS)[number];

export const MODULE_KEYS = ['admin', 'files', 'scheduling', 'leave', 'pay', 'documents', 'forms'] as const;

export const tenantSettingsSchema = z.object({
  timezone: timezoneSchema,
  terminology: z
    .partialRecord(z.enum(TERMINOLOGY_KEYS), z.string().trim().max(40))
    .transform((t) => Object.fromEntries(Object.entries(t).filter(([, v]) => v.length > 0))),
  enabledModules: z.array(z.enum(MODULE_KEYS)),
});
export type TenantSettingsInput = z.infer<typeof tenantSettingsSchema>;
