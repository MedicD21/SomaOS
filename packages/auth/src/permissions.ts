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
  'notifications.send': { label: 'Send notifications', module: 'notifications' },
} as const satisfies Record<string, PermissionInfo>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}
