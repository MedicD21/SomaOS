import type { Permission } from '@soma/auth';

export type DepartmentTemplate = {
  key: string;
  label: string;
  orgUnitTypes: { key: string; label: string; sort: number }[];
  ranks: { key: string; label: string; sort: number }[];
  shifts: { key: string; label: string; color: string }[];
  roles: { key: string; label: string; permissions: Permission[] }[];
  enabledModules: string[];
};
