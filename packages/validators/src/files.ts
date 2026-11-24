export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/heic',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
] as const;

/** Returns an error message, or null when the file may be uploaded. */
export function validateUpload(file: { size: number; type: string }): string | null {
  if (file.size <= 0) return 'File is empty';
  if (file.size > MAX_UPLOAD_BYTES) return 'File exceeds 25 MB';
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) return 'File type not allowed';
  return null;
}

/** Storage-safe file name: no directories, only [A-Za-z0-9._-], max 120 chars. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(-120);
  return cleaned || 'file';
}
