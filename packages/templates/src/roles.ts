import type { Permission } from '@soma/auth';
import { ALL_PERMISSIONS } from '@soma/auth';
import type { DepartmentTemplate } from './types';

const VIEW: Permission[] = ['files.view'];
const OFFICER: Permission[] = ['admin.members.view', 'files.view', 'files.upload', 'notifications.send'];

/** Default roles from the master design §5.5. Departments clone and edit these. */
export const DEFAULT_ROLES: DepartmentTemplate['roles'] = [
  { key: 'dept_admin', label: 'Department Admin', permissions: [...ALL_PERMISSIONS] },
  { key: 'chief_officer', label: 'Chief Officer', permissions: [...OFFICER, 'admin.members.manage', 'admin.audit.view', 'admin.config.manage'] },
  { key: 'shift_commander', label: 'Battalion / Shift Commander', permissions: OFFICER },
  { key: 'company_officer', label: 'Company Officer', permissions: OFFICER },
  { key: 'member', label: 'Member', permissions: VIEW },
  { key: 'volunteer', label: 'Volunteer', permissions: VIEW },
  { key: 'probationary', label: 'Probationary', permissions: VIEW },
  { key: 'scheduler', label: 'Scheduler', permissions: OFFICER },
  { key: 'payroll_hr', label: 'Payroll / HR', permissions: [...OFFICER, 'admin.members.manage', 'admin.custom_fields.manage'] },
  { key: 'training_officer', label: 'Training Officer', permissions: OFFICER },
  { key: 'logistics_officer', label: 'Logistics / Inventory Officer', permissions: OFFICER },
  { key: 'ems_officer', label: 'EMS Officer / QA Reviewer', permissions: OFFICER },
  { key: 'medical_director', label: 'Medical Director', permissions: VIEW },
  { key: 'fleet_maintenance', label: 'Fleet / Maintenance', permissions: VIEW },
  { key: 'auditor', label: 'Read-only Auditor', permissions: ['admin.members.view', 'admin.audit.view', 'files.view'] },
  { key: 'external', label: 'External / Mutual Aid', permissions: [] },
];
