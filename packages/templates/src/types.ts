import type { Permission } from '@soma/auth';
import type { ShiftPattern, Validity } from '@soma/schedule-engine';
import type { InventoryTemplate } from './inventory';
import type { LeaveTemplate } from './leave';
import type { PayTemplate } from './pay';
import type { DocumentsTemplate } from './documents';
import type { TrainingTemplate } from './training';

export type DepartmentTemplate = {
  key: string;
  label: string;
  orgUnitTypes: { key: string; label: string; sort: number }[];
  ranks: { key: string; label: string; sort: number }[];
  shifts: { key: string; label: string; color: string }[];
  roles: { key: string; label: string; permissions: Permission[] }[];
  enabledModules: string[];
  credentialTypes: { key: string; label: string; validity: Validity; warnDays: number[] }[];
  /** Platoon keys in the payload are the template's shift keys. */
  schedulePattern: { key: string; payload: ShiftPattern } | null;
  inventory: InventoryTemplate;
  leave: LeaveTemplate;
  pay: PayTemplate;
  documents: DocumentsTemplate;
  training: TrainingTemplate;
};
