export type Sensitivity = 'PHI' | 'HR' | 'MEDICAL' | 'CJI';

export type PermissionInfo = {
  label: string;
  module: string;
  sensitive?: Sensitivity;
};

/** Every permission in SomaOS. Modules add their entries here as they ship. */
export const PERMISSIONS = {
  'admin.tenant.manage': { label: 'Manage department settings', module: 'admin' },
  'admin.org.manage': { label: 'Manage org structure, ranks and shifts', module: 'admin' },
  'admin.members.view': { label: 'View members', module: 'admin', sensitive: 'HR' },
  'admin.members.manage': { label: 'Create and edit members', module: 'admin', sensitive: 'HR' },
  'admin.roles.manage': { label: 'Manage roles and grants', module: 'admin' },
  'admin.audit.view': { label: 'View audit log', module: 'admin' },
  'admin.config.manage': { label: 'Approve configuration versions', module: 'admin' },
  'admin.custom_fields.manage': { label: 'Manage custom fields', module: 'admin' },
  'files.upload': { label: 'Upload files', module: 'files' },
  'files.view': { label: 'View files', module: 'files' },
  'scheduling.roster.view': { label: 'View roster', module: 'scheduling' },
  'scheduling.roster.edit': { label: 'Fill and change roster', module: 'scheduling' },
  'scheduling.qualification.override': { label: 'Override qualification blocks', module: 'scheduling' },
  'scheduling.trade.request': { label: 'Propose and answer shift trades', module: 'scheduling' },
  'scheduling.openshift.claim': { label: 'Claim open shifts', module: 'scheduling' },
  'scheduling.config.manage': { label: 'Manage shift patterns and seats', module: 'scheduling' },
  'credentials.view': { label: 'View member credentials', module: 'credentials', sensitive: 'HR' },
  'credentials.manage': { label: 'Record member credentials', module: 'credentials', sensitive: 'HR' },
  'leave.request': { label: 'Request leave', module: 'leave' },
  'leave.approve': { label: 'Approve or deny leave requests', module: 'leave' },
  'leave.view': { label: 'View leave balances and requests', module: 'leave', sensitive: 'HR' },
  'leave.manage': { label: 'Manage leave banks, policies and balances', module: 'leave', sensitive: 'HR' },
  'pay.view': { label: 'View pay rates and pay period results', module: 'pay', sensitive: 'HR' },
  'pay.manage': { label: 'Manage pay codes, rates and pay rules', module: 'pay', sensitive: 'HR' },
  'documents.view': { label: 'View the document and SOG library', module: 'documents' },
  'documents.manage': { label: 'Manage folders, documents and draft versions', module: 'documents' },
  'documents.publish': { label: 'Publish and supersede document versions', module: 'documents' },
  'documents.backdate': { label: 'Publish a version with an earlier effective date', module: 'documents' },
  'sog.assign': { label: 'Assign required reading', module: 'documents' },
  'sog.acknowledge': { label: 'Acknowledge required reading', module: 'documents' },
  'sog.report': { label: 'See who has read required documents', module: 'documents' },
  'forms.manage': { label: 'Build and publish forms', module: 'forms' },
  'forms.submit': { label: 'Fill in and submit forms', module: 'forms' },
  'forms.approve': { label: 'Approve or return submitted forms', module: 'forms' },
  'forms.view_all': { label: 'View all form submissions', module: 'forms', sensitive: 'HR' },
  // Controlled-substance custody. Four separate permissions; none implies another.
  'custody.record': { label: 'Record custody movements and counts at a unit', module: 'custody', sensitive: 'MEDICAL' },
  'custody.witness': { label: 'Witness custody waste, transfers and counts', module: 'custody', sensitive: 'MEDICAL' },
  'custody.audit': { label: 'Read all custody records (read-only)', module: 'custody', sensitive: 'MEDICAL' },
  'custody.manage': { label: 'Manage the custody catalog, adjustments and discrepancies', module: 'custody', sensitive: 'MEDICAL' },
  'inventory.asset.view': { label: 'View assets and their history', module: 'inventory' },
  'inventory.asset.manage': { label: 'Manage asset types and assets', module: 'inventory' },
  'inventory.asset.event': { label: 'Log asset events and change status or location', module: 'inventory' },
  'inventory.check.perform': { label: 'Complete checklists and rig checks', module: 'inventory' },
  'inventory.check.manage': { label: 'Manage checklist templates', module: 'inventory' },
  'inventory.stock.view': { label: 'View stock levels and low-stock lists', module: 'inventory' },
  'inventory.stock.use': { label: 'Use and move stock', module: 'inventory' },
  'inventory.stock.manage': { label: 'Receive, adjust and set par levels', module: 'inventory' },
  'notifications.send': { label: 'Send notifications', module: 'notifications' },
} as const satisfies Record<string, PermissionInfo>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}
