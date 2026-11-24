import { describe, expect, it } from 'vitest';
import { SOMA_PACKAGE } from '../src/index';

describe('validators package', () => {
  it('identifies itself', () => {
    expect(SOMA_PACKAGE).toBe('@soma/validators');
  });
});
