import type { Permission } from '@soma/auth';
import { ALL_PERMISSIONS } from '@soma/auth';
import type { DepartmentTemplate } from './types';

const VIEW: Permission[] = ['files.view'];
const ROSTER: Permission[] = ['scheduling.roster.view', 'scheduling.roster.edit'];
const TRADE: Permission[] = ['scheduling.trade.request'];
const LEAVE_APPROVER: Permission[] = ['leave.request', 'leave.approve', 'leave.view'];
const OFFICER: Permission[] = ['admin.members.view', 'files.view', 'files.upload', 'notifications.send'];

/** Default roles from the master design §5.5. Departments clone and edit these. */
export const DEFAULT_ROLES: DepartmentTemplate['roles'] = [
  { key: 'dept_admin', label: 'Department Admin', permissions: [...ALL_PERMISSIONS] },
  { key: 'chief_officer', label: 'Chief Officer', permissions: [...OFFICER, ...ROSTER, ...TRADE, ...LEAVE_APPROVER, 'scheduling.qualification.override', 'admin.members.manage', 'admin.audit.view', 'admin.config.manage'] },
  { key: 'shift_commander', label: 'Battalion / Shift Commander', permissions: [...OFFICER, ...ROSTER, ...TRADE, ...LEAVE_APPROVER] },
  { key: 'company_officer', label: 'Company Officer', permissions: [...OFFICER, ...ROSTER, ...TRADE, ...LEAVE_APPROVER] },
  { key: 'member', label: 'Member', permissions: [...VIEW, 'scheduling.roster.view', ...TRADE, 'leave.request'] },
  { key: 'volunteer', label: 'Volunteer', permissions: [...VIEW, 'scheduling.roster.view', ...TRADE, 'leave.request'] },
  { key: 'probationary', label: 'Probationary', permissions: [...VIEW, 'scheduling.roster.view', ...TRADE, 'leave.request'] },
  { key: 'scheduler', label: 'Scheduler', permissions: [...OFFICER, ...ROSTER, 'scheduling.config.manage', 'scheduling.qualification.override'] },
  { key: 'payroll_hr', label: 'Payroll / HR', permissions: [...OFFICER, 'admin.members.manage', 'admin.custom_fields.manage', 'credentials.view', 'credentials.manage', 'scheduling.roster.view', 'leave.request', 'leave.view', 'leave.manage', 'pay.view', 'pay.manage'] },
  { key: 'training_officer', label: 'Training Officer', permissions: [...OFFICER, 'credentials.view', 'credentials.manage'] },
  { key: 'logistics_officer', label: 'Logistics / Inventory Officer', permissions: OFFICER },
  { key: 'ems_officer', label: 'EMS Officer / QA Reviewer', permissions: OFFICER },
  { key: 'medical_director', label: 'Medical Director', permissions: VIEW },
  { key: 'fleet_maintenance', label: 'Fleet / Maintenance', permissions: VIEW },
  { key: 'auditor', label: 'Read-only Auditor', permissions: ['admin.members.view', 'admin.audit.view', 'files.view'] },
  { key: 'external', label: 'External / Mutual Aid', permissions: [] },
];
