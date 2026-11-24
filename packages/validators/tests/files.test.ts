import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, safeFileName, validateUpload } from '../src/index';

describe('validateUpload', () => {
  it('accepts allowed types under 25 MB', () => {
    expect(validateUpload({ size: 1024, type: 'application/pdf' })).toBeNull();
    expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
  });
  it('rejects files over 25 MB', () => {
    expect(validateUpload({ size: MAX_UPLOAD_BYTES + 1, type: 'application/pdf' })).toBe('File exceeds 25 MB');
  });
  it('rejects disallowed types and empty files', () => {
    expect(validateUpload({ size: 10, type: 'application/x-msdownload' })).toBe('File type not allowed');
    expect(validateUpload({ size: 0, type: 'text/plain' })).toBe('File is empty');
  });
});

describe('safeFileName', () => {
  it('keeps a readable, path-safe name', () => {
    expect(safeFileName('../../Fit Test 2026 (final).pdf')).toBe('Fit_Test_2026_final_.pdf');
    expect(safeFileName('')).toBe('file');
  });
});
