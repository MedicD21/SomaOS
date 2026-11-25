import type { Permission } from '@soma/auth';
import { ALL_PERMISSIONS } from '@soma/auth';
import type { DepartmentTemplate } from './types';

const VIEW: Permission[] = ['files.view'];
const ROSTER: Permission[] = ['scheduling.roster.view', 'scheduling.roster.edit'];
/** Self-service scheduling: propose and answer trades, claim open shifts. */
const TRADE: Permission[] = ['scheduling.trade.request', 'scheduling.openshift.claim'];
const INV_READ: Permission[] = ['inventory.asset.view', 'inventory.stock.view'];
const INV_FLOOR: Permission[] = [...INV_READ, 'inventory.check.perform', 'inventory.stock.use'];
const INV_OFFICER: Permission[] = [...INV_FLOOR, 'inventory.asset.event'];
const INV_MANAGER: Permission[] = [...INV_OFFICER, 'inventory.asset.manage', 'inventory.check.manage', 'inventory.stock.manage'];
const LEAVE_APPROVER: Permission[] = ['leave.request', 'leave.approve', 'leave.view'];
/** Reading and filling in what the department publishes. */
const READER: Permission[] = ['documents.view', 'sog.acknowledge', 'forms.submit'];
/** Running the library: manage and publish documents, assign reading, build forms, approve and report. */
const LIBRARIAN: Permission[] = ['documents.manage', 'documents.publish', 'sog.assign', 'sog.report', 'forms.manage', 'forms.approve'];
/** Controlled-substance custody. Four separate permissions; Department Admin holds none by default. */
const CUSTODY_FLOOR: Permission[] = ['custody.record', 'custody.witness'];
const CUSTODY_OFFICER: Permission[] = ['custody.audit', 'custody.manage'];
/** Members browse the catalog and sign up; unit officers run sessions and see their unit's compliance; trainers manage everything. */
const TRAIN_MEMBER: Permission[] = ['training.course.view', 'training.session.view'];
const TRAIN_UNIT: Permission[] = [...TRAIN_MEMBER, 'training.session.manage', 'training.attendance.mark', 'training.compliance.view'];
const TRAIN_MANAGER: Permission[] = [...TRAIN_UNIT, 'training.attendance.manage', 'training.course.manage'];
const OFFICER: Permission[] = ['admin.members.view', 'files.view', 'files.upload', 'notifications.send'];

/** Default roles from the master design §5.5. Departments clone and edit these. */
export const DEFAULT_ROLES: DepartmentTemplate['roles'] = [
  { key: 'dept_admin', label: 'Department Admin', permissions: ALL_PERMISSIONS.filter((p) => !p.startsWith('custody.')) },
  { key: 'chief_officer', label: 'Chief Officer', permissions: [...TRAIN_UNIT, ...INV_OFFICER, ...OFFICER, ...ROSTER, ...TRADE, ...LEAVE_APPROVER, ...READER, ...LIBRARIAN, 'scheduling.qualification.override', 'admin.members.manage', 'admin.audit.view', 'admin.config.manage'] },
  { key: 'shift_commander', label: 'Battalion / Shift Commander', permissions: [...TRAIN_UNIT, ...CUSTODY_FLOOR, ...INV_OFFICER, ...OFFICER, ...ROSTER, ...TRADE, ...LEAVE_APPROVER, ...READER, 'sog.report', 'forms.approve'] },
  { key: 'company_officer', label: 'Company Officer', permissions: [...TRAIN_UNIT, ...CUSTODY_FLOOR, ...INV_OFFICER, ...OFFICER, ...ROSTER, ...TRADE, ...LEAVE_APPROVER, ...READER, 'sog.report', 'forms.approve'] },
  { key: 'member', label: 'Member', permissions: [...TRAIN_MEMBER, ...CUSTODY_FLOOR, ...INV_FLOOR, ...VIEW, 'scheduling.roster.view', ...TRADE, 'leave.request', ...READER] },
  { key: 'volunteer', label: 'Volunteer', permissions: [...TRAIN_MEMBER, ...INV_FLOOR, ...VIEW, 'scheduling.roster.view', ...TRADE, 'leave.request', ...READER] },
  { key: 'probationary', label: 'Probationary', permissions: [...TRAIN_MEMBER, ...INV_FLOOR, ...VIEW, 'scheduling.roster.view', ...TRADE, 'leave.request', ...READER] },
  { key: 'scheduler', label: 'Scheduler', permissions: [...OFFICER, ...ROSTER, ...READER, 'scheduling.config.manage', 'scheduling.qualification.override'] },
  { key: 'payroll_hr', label: 'Payroll / HR', permissions: [...OFFICER, ...READER, 'admin.members.manage', 'admin.custom_fields.manage', 'credentials.view', 'credentials.manage', 'scheduling.roster.view', 'leave.request', 'leave.view', 'leave.manage', 'pay.view', 'pay.manage'] },
  { key: 'training_officer', label: 'Training Officer', permissions: [...TRAIN_MANAGER, ...OFFICER, ...READER, ...LIBRARIAN, 'credentials.view', 'credentials.manage'] },
  { key: 'logistics_officer', label: 'Logistics / Inventory Officer', permissions: [...INV_MANAGER, ...OFFICER, ...READER] },
  { key: 'ems_officer', label: 'EMS Officer / QA Reviewer', permissions: [...OFFICER, ...READER] },
  { key: 'medical_director', label: 'Medical Director', permissions: [...VIEW, ...CUSTODY_OFFICER] },
  { key: 'fleet_maintenance', label: 'Fleet / Maintenance', permissions: [...VIEW, ...INV_MANAGER] },
  { key: 'auditor', label: 'Read-only Auditor', permissions: ['admin.members.view', 'admin.audit.view', 'files.view', 'documents.view', 'sog.report', 'forms.view_all', ...INV_READ, 'custody.audit', 'training.course.view', 'training.session.view', 'training.compliance.view'] },
  { key: 'cs_officer', label: 'Controlled-Substance Officer', permissions: [...OFFICER, ...READER, ...CUSTODY_OFFICER] },
  { key: 'external', label: 'External / Mutual Aid', permissions: [] },
];
