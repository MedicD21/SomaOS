import { career3Platoon } from './career-3-platoon';
import { volunteer } from './volunteer';

export type { DepartmentTemplate } from './types';
export { applyTemplate } from './apply';
export type { FirstAdmin } from './apply';
export { DEFAULT_ROLES } from './roles';
export type { LeaveTemplate } from './leave';
export type { PayTemplate } from './pay';

export const TEMPLATES = {
  'career-3-platoon': career3Platoon,
  volunteer,
} as const;
