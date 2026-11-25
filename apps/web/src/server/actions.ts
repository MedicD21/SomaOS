import 'server-only';
import { revalidatePath } from 'next/cache';
import type { Permission } from '@soma/auth';
import type { RequestContext } from './context';
import { check, getRequestContext, hasAny, withCtxDb } from './context';
import type { Tx } from './db';
import { ActionError } from './errors';

export { ActionError };

export type ActionResult = { ok: boolean | null; message: string | null; fieldErrors?: Record<string, string> };
export const IDLE: ActionResult = { ok: null, message: null };

/** Maps database errors to messages a department admin can act on. */
const LEAVE_MESSAGES =
  /^(No scheduled shifts|insufficient balance|lead time:|not in your scope|the end date is before|that leave has already started|A seat was refilled|this request is already|a reason is required|unknown leave type|not a member of this department|explain the adjustment|enter a non-zero|leave limit:|an override reason|not allowed: overriding a leave limit)/i;

/** Plain-English messages raised by the asset, checklist and inventory functions. */
const INVENTORY_MESSAGES =
  /^(Enter a (name|quantity|change)|Unknown (or archived asset type|location|asset|item|parent|station|checklist|asset type|checklist item|asset field)|Missing required asset field|This asset|The asset is already|Choose a (status|location|new location)|Explain (why|the adjustment)|Add a note|Retire the asset|Answer (every|pass)|Enter (a number|text)|This checklist|Checklist items|Invalid checklist key|Not enough stock|Choose two different|That (item|location) is archived|Par must|Asset added|not allowed: (you cannot|inventory))/i;

const TIME_MESSAGES =
  /^(That pay period|That time entry|not allowed: you cannot|not allowed: pay\.manage|hours must be|unknown work type|choose the date|explain the time|explain why|unknown member|unknown time entry|unknown pay period|unknown leave bank|invalid pay period|that is not one of|that shift was not found|choose a shift|only upcoming|one of those shifts|that member has separated|only the member asked|this trade|that trade|only the members in|not in your scope|an override reason|overriding needs|that seat is not available|open shifts can only|the end must be after|only upcoming times|an open shift can be|explain the open shift|explain the cancellation|that open shift is|that seat is already filled|that seat and time is already|you are already scheduled|you already have a claim|only the member who claimed|this claim is|unknown open shift|unknown claim)/i;

/** Documents, readings and forms: the database functions word their own errors for people. */
const DOC_MESSAGES =
  /^(That document is archived|Upload the file first|That file is already used|Enter a |A folder cannot|Choose who|No active members|The due date|That version already|Only a (published|draft) version|That reading|You have already|A newer version|Type your full name|Draw your signature|Choose how to sign|This form must be signed|That form is not|You can only correct|That submission|A correction must|The form |Unknown (field|approval)|Answers must|Explain |Choose approve|unknown (form|submission|version|reading|document|folder)|not allowed: (documents|sog|forms)\.|not allowed: only the submitter|.+ is required$|.+ must (be|only|not)\b)/;

export function friendlyDbError(e: unknown): string {
  if (e instanceof ActionError) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  if (/org unit cycle/.test(msg)) return 'A unit cannot be moved under itself or one of its own sub-units.';
  if (/cannot remove last admin/.test(msg)) return 'cannot remove last admin: the department must keep at least one department-wide admin.';
  if (/duplicate key/.test(msg)) return 'That key or name is already in use.';
  if (/member_assignments_no_overlap/.test(msg)) return 'That member already has a primary assignment for those dates.';
  if (/shift_assignments_seat_no_overlap/.test(msg)) return 'That seat is already filled for that time.';
  if (/shift_assignments_member_no_overlap/.test(msg)) return 'That member is already scheduled during that time.';
  if (/standing_seats_member_no_overlap/.test(msg)) return 'That member already has a regular seat for those dates.';
  if (/row-level security|permission denied/.test(msg)) return 'You do not have permission to make that change.';
  if (/unknown timezone/.test(msg)) return 'Unknown time zone.';
  if (/member_pay_rates_member_no_overlap/.test(msg)) return 'That rate overlaps another rate for the same member. Choose a later start date.';
  if (/leave_requests_member_no_overlap/.test(msg)) return 'You already have leave requested for some of those dates.';
  // The leave functions raise plain-English messages meant for people; pass them through.
  if (TIME_MESSAGES.test(msg) || INVENTORY_MESSAGES.test(msg) || /^Unknown leave bank/.test(msg)) return msg.charAt(0).toUpperCase() + msg.slice(1);
  if (LEAVE_MESSAGES.test(msg)) return msg.charAt(0).toUpperCase() + msg.slice(1);
  if (DOC_MESSAGES.test(msg)) return msg.charAt(0).toUpperCase() + msg.slice(1);
  if (/config_versions_no_overlap/.test(msg)) return 'That effective date overlaps another approved version.';
  console.error(e);
  return 'Something went wrong saving your change.';
}

/**
 * Runs an admin mutation: checks permission, runs fn as the signed-in user (RLS applies),
 * records an optional change reason for the audit log, and revalidates admin pages.
 */
export async function runAdmin(
  permission: Permission,
  form: FormData | null,
  fn: (tx: Tx, ctx: RequestContext) => Promise<string>,
): Promise<ActionResult> {
  const ctx = await getRequestContext();
  const decision = check(ctx, permission);
  if (!decision.allowed) return { ok: false, message: `Not allowed: ${decision.reason}` };
  try {
    const reason = form?.get('reason');
    const message = await withCtxDb(ctx, async (tx) => {
      if (typeof reason === 'string' && reason.trim()) await tx`select set_config('app.reason', ${reason.trim()}, true)`;
      return fn(tx, ctx);
    });
    revalidatePath('/', 'layout');
    return { ok: true, message };
  } catch (e) {
    return { ok: false, message: friendlyDbError(e) };
  }
}

/**
 * Like runAdmin, but the caller needs any one of several permissions in any scope; the database
 * functions decide whether the specific member or date is within the caller's scope.
 */
export async function runScoped(
  permissions: Permission[],
  fn: (tx: Tx, ctx: RequestContext) => Promise<string>,
): Promise<ActionResult> {
  const ctx = await getRequestContext();
  if (!permissions.some((p) => hasAny(ctx, p))) return { ok: false, message: 'Not allowed.' };
  try {
    const message = await withCtxDb(ctx, (tx) => fn(tx, ctx));
    revalidatePath('/', 'layout');
    return { ok: true, message };
  } catch (e) {
    return { ok: false, message: friendlyDbError(e) };
  }
}

export function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]): ActionResult {
  const fieldErrors: Record<string, string> = {};
  for (const i of issues) fieldErrors[i.path.join('.')] ??= i.message;
  return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors };
}
