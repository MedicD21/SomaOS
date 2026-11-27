import 'server-only';
import type { Permission } from '@soma/auth';
import type { RequestContext } from './context';
import { hasAny, t } from './context';

export type NavItem = { href: string; label: string; module: string; anyOf?: Permission[] };

/** Navigation registry. Modules append entries as they ship. */
export const NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', module: 'core' },
  { href: '/schedule', label: 'My schedule', module: 'scheduling' },
  { href: '/roster', label: 'Roster', module: 'scheduling', anyOf: ['scheduling.roster.view'] },
  { href: '/trades', label: 'Shift trades', module: 'scheduling', anyOf: ['scheduling.trade.request', 'scheduling.roster.edit'] },
  { href: '/open-shifts', label: 'Open shifts', module: 'scheduling', anyOf: ['scheduling.openshift.claim', 'scheduling.roster.edit'] },
  { href: '/mandate', label: 'Mandate list', module: 'scheduling', anyOf: ['scheduling.roster.view', 'scheduling.mandate.manage'] },
  { href: '/pay', label: 'Pay', module: 'pay', anyOf: ['pay.view', 'pay.manage'] },
  { href: '/time', label: 'Time', module: 'pay', anyOf: ['scheduling.roster.edit', 'pay.manage'] },
  { href: '/training', label: 'Training', module: 'training', anyOf: ['training.session.view', 'training.session.manage'] },
  { href: '/training/compliance', label: 'Compliance', module: 'training', anyOf: ['training.compliance.view'] },
  { href: '/documents', label: 'Documents', module: 'documents', anyOf: ['documents.view', 'documents.manage'] },
  { href: '/sogs', label: 'SOGs', module: 'documents', anyOf: ['sog.acknowledge', 'sog.report', 'sog.assign'] },
  { href: '/forms', label: 'Forms', module: 'forms', anyOf: ['forms.submit', 'forms.approve', 'forms.manage', 'forms.view_all'] },
  { href: '/assets', label: 'Assets', module: 'inventory', anyOf: ['inventory.asset.view'] },
  { href: '/checks', label: 'Checks', module: 'inventory', anyOf: ['inventory.check.perform', 'inventory.asset.view'] },
  { href: '/inventory', label: 'Inventory', module: 'inventory', anyOf: ['inventory.stock.view'] },
  { href: '/custody', label: 'Custody', module: 'custody', anyOf: ['custody.record', 'custody.witness', 'custody.audit', 'custody.manage'] },
  { href: '/leave', label: 'My leave', module: 'leave', anyOf: ['leave.request'] },
  { href: '/leave/approvals', label: 'Leave approvals', module: 'leave', anyOf: ['leave.approve'] },
  {
    href: '/admin',
    label: 'Admin',
    module: 'admin',
    anyOf: ['admin.tenant.manage', 'admin.org.manage', 'admin.members.view', 'admin.roles.manage', 'admin.audit.view', 'admin.custom_fields.manage', 'scheduling.config.manage', 'leave.manage', 'pay.manage', 'forms.manage', 'inventory.asset.manage', 'inventory.check.manage', 'inventory.stock.manage', 'custody.manage', 'training.course.manage'],
  },
];

/** Admin section sub-navigation; each entry is shown only to holders of its permission. */
export const ADMIN_NAV: (NavItem & { anyOf: Permission[] })[] = [
  { href: '/admin/settings', label: 'Settings', module: 'admin', anyOf: ['admin.tenant.manage'] },
  { href: '/admin/org', label: 'Org structure', module: 'admin', anyOf: ['admin.org.manage'] },
  { href: '/admin/ranks', label: 'Ranks', module: 'admin', anyOf: ['admin.org.manage'] },
  { href: '/admin/shifts', label: 'Shifts', module: 'admin', anyOf: ['admin.org.manage'] },
  { href: '/admin/members', label: 'Members', module: 'admin', anyOf: ['admin.members.view'] },
  { href: '/admin/custom-fields', label: 'Custom fields', module: 'admin', anyOf: ['admin.custom_fields.manage'] },
  { href: '/admin/roles', label: 'Roles', module: 'admin', anyOf: ['admin.roles.manage'] },
  { href: '/admin/grants', label: 'Grants', module: 'admin', anyOf: ['admin.roles.manage'] },
  { href: '/admin/scheduling/patterns', label: 'Shift patterns', module: 'scheduling', anyOf: ['scheduling.config.manage'] },
  { href: '/admin/scheduling/seats', label: 'Seats', module: 'scheduling', anyOf: ['scheduling.config.manage'] },
  { href: '/admin/scheduling/staffing', label: 'Staffing rules', module: 'scheduling', anyOf: ['scheduling.config.manage'] },
  { href: '/admin/scheduling/credential-types', label: 'Credential types', module: 'scheduling', anyOf: ['scheduling.config.manage'] },
  { href: '/admin/leave', label: 'Leave', module: 'leave', anyOf: ['leave.manage'] },
  { href: '/admin/pay', label: 'Pay', module: 'pay', anyOf: ['pay.manage'] },
  { href: '/admin/form-definitions', label: 'Form builder', module: 'forms', anyOf: ['forms.manage'] },
  { href: '/admin/training', label: 'Training', module: 'training', anyOf: ['training.course.manage'] },
  { href: '/admin/assets', label: 'Asset types', module: 'inventory', anyOf: ['inventory.asset.manage'] },
  { href: '/admin/checklists', label: 'Checklists', module: 'inventory', anyOf: ['inventory.check.manage'] },
  { href: '/admin/inventory', label: 'Items and locations', module: 'inventory', anyOf: ['inventory.stock.manage'] },
  { href: '/admin/custody', label: 'Custody', module: 'custody', anyOf: ['custody.manage'] },
  { href: '/admin/audit', label: 'Audit log', module: 'admin', anyOf: ['admin.audit.view'] },
];

export function visibleNav(ctx: RequestContext, items: NavItem[] = NAV): NavItem[] {
  return items
    .filter((i) => i.module === 'core' || ctx.tenant.enabledModules.includes(i.module))
    .filter((i) => !i.anyOf || i.anyOf.some((p) => hasAny(ctx, p)))
    .map((i) => ({ ...i, label: t(ctx, `nav.${i.href}`, i.label) }));
}

/** Admin sub-navigation the caller may see: module enabled (admin is always on) and permission held. */
export function visibleAdminNav(ctx: RequestContext): (NavItem & { anyOf: Permission[] })[] {
  return ADMIN_NAV.filter((i) => i.module === 'admin' || ctx.tenant.enabledModules.includes(i.module)).filter((i) =>
    i.anyOf.some((p) => hasAny(ctx, p)),
  );
}
