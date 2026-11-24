import { describe, expect, it } from 'vitest';
import { MIN_PASSWORD_LENGTH, passwordSetupSchema } from '../src/index';

const ok = 'Correct-Horse-9';

describe('passwordSetupSchema', () => {
  it('accepts a long enough matching password', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(passwordSetupSchema.safeParse({ password: ok, confirm: ok }).success).toBe(true);
  });
  it('rejects short passwords with a clear message', () => {
    const r = passwordSetupSchema.safeParse({ password: 'short-1', confirm: 'short-1' });
    expect(r.error?.issues[0]?.message).toBe('Use at least 12 characters');
    expect(r.error?.issues[0]?.path).toEqual(['password']);
  });
  it('rejects mismatched confirmation on the confirm field', () => {
    const r = passwordSetupSchema.safeParse({ password: ok, confirm: `${ok}x` });
    expect(r.error?.issues[0]).toMatchObject({ path: ['confirm'], message: 'The passwords do not match' });
  });
  it('rejects the obvious: the email address or only whitespace', () => {
    expect(passwordSetupSchema.safeParse({ password: ' '.repeat(14), confirm: ' '.repeat(14) }).success).toBe(false);
  });
});
