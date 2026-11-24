import { z } from 'zod';

/** Snake_case machine key, e.g. "ff_paramedic". */
export const keySchema = z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use lowercase letters, numbers and _');
export const labelSchema = z.string().trim().min(1, 'Required').max(80);
/** Form inputs send "" for "none". */
export const optionalUuid = z
  .union([z.uuid(), z.literal(''), z.null(), z.undefined()])
  .transform((v) => (v ? v : null));

const VALID_TIMEZONES = new Set<string>([...Intl.supportedValuesOf('timeZone'), 'UTC']);
export const timezoneSchema = z.string().refine((v) => VALID_TIMEZONES.has(v), 'Unknown time zone');
export const timezoneOptions = (): string[] => [...VALID_TIMEZONES].sort();
