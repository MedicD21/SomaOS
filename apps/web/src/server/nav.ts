import 'server-only';
import type { Permission } from '@soma/auth';
import type { RequestContext } from './context';
import { hasAny, t } from './context';

export type NavItem = { href: string; label: string; module: string; anyOf?: Permission[] };

/** Navigation registry. Modules append entries as they ship. */
export const NAV: NavItem[] = [{ href: '/', label: 'Dashboard', module: 'core' }];

export function visibleNav(ctx: RequestContext, items: NavItem[] = NAV): NavItem[] {
  return items
    .filter((i) => i.module === 'core' || ctx.tenant.enabledModules.includes(i.module))
    .filter((i) => !i.anyOf || i.anyOf.some((p) => hasAny(ctx, p)))
    .map((i) => ({ ...i, label: t(ctx, `nav.${i.href}`, i.label) }));
}
