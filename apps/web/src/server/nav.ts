import 'server-only';
import type { Permission } from '@soma/auth';
import type { RequestContext } from './context';
import { hasAny, t } from './context';

export type NavItem = { href: string; label: string; module: string; anyOf?: Permission[] };

/** Navigation registry. Modules append entries as they ship. */
export const NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', module: 'core' },
  {
    href: '/admin',
    label: 'Admin',
    module: 'admin',
    anyOf: ['admin.tenant.manage', 'admin.org.manage', 'admin.members.view', 'admin.roles.manage', 'admin.audit.view', 'admin.custom_fields.manage'],
  },
];

/** Admin section sub-navigation; each entry is shown only to holders of its permission. */
export const ADMIN_NAV: (NavItem & { anyOf: Permission[] })[] = [
  { href: '/admin/settings', label: 'Settings', module: 'admin', anyOf: ['admin.tenant.manage'] },
  { href: '/admin/org', label: 'Org structure', module: 'admin', anyOf: ['admin.org.manage'] },
  { href: '/admin/ranks', label: 'Ranks', module: 'admin', anyOf: ['admin.org.manage'] },
  { href: '/admin/shifts', label: 'Shifts', module: 'admin', anyOf: ['admin.org.manage'] },
];

export function visibleNav(ctx: RequestContext, items: NavItem[] = NAV): NavItem[] {
  return items
    .filter((i) => i.module === 'core' || ctx.tenant.enabledModules.includes(i.module))
    .filter((i) => !i.anyOf || i.anyOf.some((p) => hasAny(ctx, p)))
    .map((i) => ({ ...i, label: t(ctx, `nav.${i.href}`, i.label) }));
}
