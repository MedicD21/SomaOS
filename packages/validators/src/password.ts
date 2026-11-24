import { z } from 'zod';

export const MIN_PASSWORD_LENGTH = 12;

/** Choosing a password: long enough (spaces at the ends do not count) and typed twice the same. */
export const passwordSetupSchema = z
  .object({
    password: z.string().refine((p) => p.trim().length >= MIN_PASSWORD_LENGTH, {
      message: `Use at least ${MIN_PASSWORD_LENGTH} characters`,
    }),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'The passwords do not match' });
