import { z } from 'zod';
import { keySchema, labelSchema, optionalUuid } from './common';
import { keyFromLabel } from './people';

export const ASSET_STATUSES = ['in_service', 'out_of_service', 'reserve', 'maintenance', 'retired'] as const;
export const ASSET_CATEGORIES = ['apparatus', 'equipment', 'medical_device', 'ppe', 'other'] as const;
export const ASSET_EVENT_KINDS = ['check', 'maintenance', 'status_change', 'assignment', 'note'] as const;

export const assetTypeSchema = z
  .object({ label: labelSchema, key: keySchema.optional().or(z.literal('')), category: z.enum(ASSET_CATEGORIES) })
  .transform((v) => ({ label: v.label, category: v.category, key: v.key || keyFromLabel(v.label) }));

export const assetSchema = z.object({
  typeId: z.uuid('Choose a type'),
  name: z.string().trim().min(1, 'Enter a name').max(120),
  identifier: z.string().trim().max(80).optional().transform((v) => v || null),
  orgUnitId: optionalUuid,
});

const noteField = z.string().trim().max(500).optional().transform((v) => v || null);

export const assetEventSchema = z
  .object({
    assetId: z.uuid(),
    kind: z.enum(ASSET_EVENT_KINDS),
    toStatus: z.enum(ASSET_STATUSES).optional().or(z.literal('').transform(() => undefined)),
    toOrgUnitId: optionalUuid,
    note: noteField,
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'status_change' && !v.toStatus) ctx.addIssue({ code: 'custom', path: ['toStatus'], message: 'Choose a status' });
    if (v.kind === 'assignment' && !v.toOrgUnitId) ctx.addIssue({ code: 'custom', path: ['toOrgUnitId'], message: 'Choose the new location' });
    if ((v.kind === 'note' || v.kind === 'maintenance') && !v.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Add a note' });
    if (v.kind === 'status_change' && (v.toStatus === 'out_of_service' || v.toStatus === 'retired') && (v.note ?? '').length < 5) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Explain why (at least 5 characters)' });
    }
  });

export const archiveAssetSchema = z.object({ assetId: z.uuid(), reason: z.string().trim().min(5, 'Explain why (at least 5 characters)').max(300) });
