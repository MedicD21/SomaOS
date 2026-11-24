import type { Permission } from './permissions';
import { isPermission } from './permissions';

export type GrantScope = { kind: 'self' } | { kind: 'department' } | { kind: 'org_unit'; path: string };

export type Grant = {
  permission: Permission;
  scope: GrantScope;
  shiftId?: string | null;
  validFrom: Date;
  validTo: Date | null;
  roleKey: string;
};

export type Target = {
  orgUnitPath?: string | null;
  shiftId?: string | null;
  ownerMemberId?: string | null;
};

export type Decision = { allowed: boolean; reason: string; matchedRole?: string };

const isActive = (g: Grant, at: Date): boolean =>
  g.validFrom.getTime() <= at.getTime() && (g.validTo === null || at.getTime() < g.validTo.getTime());

/** True when `path` equals `ancestor` or is below it (ltree dot-label semantics). */
export function pathWithin(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}.`);
}

function scopeCovers(g: Grant, actorMemberId: string, target: Target): boolean {
  switch (g.scope.kind) {
    case 'department':
      return true;
    case 'self':
      return target.ownerMemberId === actorMemberId;
    case 'org_unit':
      return target.orgUnitPath != null && pathWithin(target.orgUnitPath, g.scope.path);
  }
}

const shiftCovers = (g: Grant, target: Target): boolean => !g.shiftId || g.shiftId === target.shiftId;

export function can(
  grants: Grant[],
  actorMemberId: string,
  permission: Permission,
  target: Target,
  at: Date,
): Decision {
  const match = grants.find(
    (g) =>
      g.permission === permission &&
      isActive(g, at) &&
      scopeCovers(g, actorMemberId, target) &&
      shiftCovers(g, target),
  );
  if (!match) return { allowed: false, reason: `no active grant for ${permission} covering target` };
  return {
    allowed: true,
    reason: `allowed by role ${match.roleKey} (${match.scope.kind})`,
    matchedRole: match.roleKey,
  };
}

/** Row shape returned by the SQL function app.my_grants(). */
export type MyGrantRow = {
  permission: string;
  scope_kind: string;
  scope_path: string | null;
  scope_shift_id: string | null;
  valid_from: Date;
  valid_to: Date | null;
  role_key: string;
};

export function toGrants(rows: MyGrantRow[]): Grant[] {
  const grants: Grant[] = [];
  for (const r of rows) {
    if (!isPermission(r.permission)) continue;
    let scope: GrantScope;
    if (r.scope_kind === 'org_unit' && r.scope_path) scope = { kind: 'org_unit', path: r.scope_path };
    else if (r.scope_kind === 'self') scope = { kind: 'self' };
    else if (r.scope_kind === 'department') scope = { kind: 'department' };
    else continue;
    grants.push({
      permission: r.permission,
      scope,
      shiftId: r.scope_shift_id,
      validFrom: r.valid_from,
      validTo: r.valid_to,
      roleKey: r.role_key,
    });
  }
  return grants;
}
