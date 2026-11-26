import { z } from 'zod';

const checkbox = z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean());
const blankToNull = <T extends z.ZodType>(s: T) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), s.nullable()).optional().transform((v) => v ?? null);

export const DOCUMENT_KINDS = ['document', 'sog', 'policy'] as const;
export const DOCUMENT_KIND_LABEL: Record<(typeof DOCUMENT_KINDS)[number], string> = { document: 'Document', sog: 'SOG', policy: 'Policy' };

/** A folder, optionally limited to department-wide holders of a permission (for example HR). */
export const folderSchema = z.object({
  id: blankToNull(z.uuid()),
  parentId: blankToNull(z.uuid()),
  name: z.string().trim().min(1, 'Enter a folder name').max(120, 'Keep the name under 120 characters'),
  viewPermission: blankToNull(z.string().trim().regex(/^[a-z_]+\.[a-z_.]+$/, 'Use a permission code such as admin.members.manage')),
});

export const createDocumentSchema = z.object({
  folderId: z.uuid('Choose a folder'),
  kind: z.enum(DOCUMENT_KINDS),
  title: z.string().trim().min(1, 'Enter a title').max(200, 'Keep the title under 200 characters'),
  number: blankToNull(z.string().trim().max(40, 'Keep the number under 40 characters')),
  requiresAck: checkbox,
});

export const addVersionSchema = z.object({
  documentId: z.uuid(),
  label: z.string().trim().min(1, 'Enter a version label, for example 2.0').max(40, 'Keep the label under 40 characters'),
  changeNote: blankToNull(z.string().trim().max(500, 'Keep the note under 500 characters')),
});

export const publishVersionSchema = z.object({
  versionId: z.uuid(),
  effectiveFrom: blankToNull(z.iso.date('Use a valid date')),
  major: checkbox,
  backdateReason: blankToNull(z.string().trim().min(5, 'Explain the earlier effective date (at least 5 characters)').max(300)),
});

export const archiveDocumentSchema = z.object({
  documentId: z.uuid(),
  reason: z.string().trim().min(5, 'Explain why it is archived (at least 5 characters)').max(300),
});
