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
  { href: '/pay', label: 'Pay', module: 'pay', anyOf: ['pay.view', 'pay.manage'] },
  { href: '/time', label: 'Time', module: 'pay', anyOf: ['scheduling.roster.edit', 'pay.manage'] },
  { href: '/leave', label: 'My leave', module: 'leave', anyOf: ['leave.request'] },
  { href: '/leave/approvals', label: 'Leave approvals', module: 'leave', anyOf: ['leave.approve'] },
  {
    href: '/admin',
    label: 'Admin',
    module: 'admin',
    anyOf: ['admin.tenant.manage', 'admin.org.manage', 'admin.members.view', 'admin.roles.manage', 'admin.audit.view', 'admin.custom_fields.manage', 'scheduling.config.manage', 'leave.manage', 'pay.manage'],
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
  { href: '/admin/scheduling/credential-types', label: 'Credential types', module: 'scheduling', anyOf: ['scheduling.config.manage'] },
  { href: '/admin/leave', label: 'Leave', module: 'leave', anyOf: ['leave.manage'] },
  { href: '/admin/pay', label: 'Pay', module: 'pay', anyOf: ['pay.manage'] },
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
