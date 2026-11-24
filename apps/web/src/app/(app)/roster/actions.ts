'use server';
import { revalidatePath } from 'next/cache';
import { addDays, localPlusHoursToInstant, localToInstant } from '@soma/schedule-engine';
import { assignSchema } from '@soma/validators';
import { z } from 'zod';
import type { ActionResult } from '@/server/actions';
import { friendlyDbError } from '@/server/actions';
import type { RequestContext } from '@/server/context';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import type { Tx } from '@/server/db';
import { generateRoster, RosterPermissionError } from '@/server/scheduling/generate';
import { loadSeats } from '@/server/scheduling/load';
import { assignToSeat, cancelAssignment, type Can } from '@/server/scheduling/roster';

/** `overridable` is true when the only blocks are qualification rules an override may waive. */
export type AssignState = ActionResult & { blocked?: string[]; overridable?: boolean };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const uuid = z.uuid();
const MODULE_OFF: ActionResult = { ok: false, message: 'Scheduling is not enabled for this department.' };

function canFor(ctx: RequestContext): Can {
  return (permission, target) => check(ctx, permission, target).allowed;
}

/** Known service errors carry a user-facing message; anything else goes through friendlyDbError. */
function errorMessage(e: unknown): string {
  if (e instanceof RosterPermissionError || e instanceof RangeError) return e.message;
  if (e instanceof Error && e.message.startsWith('That assignment was not found')) return e.message;
  return friendlyDbError(e);
}

async function setReason(tx: Tx, reason: string | undefined): Promise<void> {
  if (reason) await tx`select set_config('app.reason', ${reason}, true)`;
}

export async function generateSchedule(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const from = String(form.get('from') ?? '');
  const to = String(form.get('to') ?? '');
  if (!DATE.test(from) || !DATE.test(to)) return { ok: false, message: 'Enter a start and end date.' };
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('scheduling')) return MODULE_OFF;
  const d = check(ctx, 'scheduling.config.manage');
  if (!d.allowed) return { ok: false, message: `Not allowed: ${d.reason}` };
  try {
    const r = await withCtxDb(ctx, (tx) => generateRoster(tx, canFor(ctx), from, addDays(to, 1)));
    revalidatePath('/roster');
    return { ok: true, message: `Generated ${r.inserted} shifts; ${r.skipped} already existed or overlapped.` };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

export async function fillSeat(seatId: string, date: string, _prev: AssignState, form: FormData): Promise<AssignState> {
  const startTime = String(form.get('startTime') ?? '');
  const hours = Number(form.get('hours'));
  if (!DATE.test(date) || !TIME.test(startTime)) return { ok: false, message: 'Enter a start time as HH:MM.' };
  if (!uuid.safeParse(seatId).success) return { ok: false, message: 'That seat no longer exists.' };
  if (!Number.isInteger(hours) || hours < 1 || hours > 48) return { ok: false, message: 'Hours must be between 1 and 48.' };
  const reason = String(form.get('overrideReason') ?? '').trim();
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('scheduling')) return MODULE_OFF;
  try {
    const result = await withCtxDb(ctx, async (tx) => {
      const [seat] = await loadSeats(tx, { seatId });
      if (!seat) return { ok: false as const, blocked: [{ rule: 'seat.missing', message: 'That seat no longer exists.' }] };
      const parsed = assignSchema.safeParse({
        seatId,
        memberId: form.get('memberId'),
        type: form.get('type'),
        start: localToInstant(date, startTime, seat.tz).toISOString(),
        end: localPlusHoursToInstant(date, startTime, hours, seat.tz).toISOString(),
        overrideReason: reason || undefined,
      });
      if (!parsed.success) {
        const field = parsed.error.issues[0]?.path[0];
        const message =
          field === 'overrideReason' ? 'An override reason of at least 5 characters is required.'
          : field === 'memberId' ? 'Choose a member.'
          : 'Check the fill details.';
        return { ok: false as const, blocked: [{ rule: field === 'overrideReason' ? 'override.reason' : 'input', message }] };
      }
      return assignToSeat(tx, canFor(ctx), parsed.data);
    });
    if (!result.ok) {
      const overridable = result.blocked.every((b) => /^(credential|rank|override)\./.test(b.rule));
      return { ok: false, message: 'This fill is blocked.', blocked: result.blocked.map((b) => b.message), overridable };
    }
    revalidatePath('/roster');
    return { ok: true, message: 'Seat filled' };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

export async function cancelShift(assignmentId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const reason = String(form.get('reason') ?? '').trim();
  if (!uuid.safeParse(assignmentId).success) return { ok: false, message: 'That assignment was not found or is already cancelled.' };
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('scheduling')) return MODULE_OFF;
  try {
    await withCtxDb(ctx, async (tx) => {
      const [row] = await tx<{ path: string }[]>`
        select ou.path::text as path from shift_assignments a
        join seats s on s.id = a.seat_id join org_units ou on ou.id = s.org_unit_id
        where a.id = ${assignmentId} and a.tenant_id = app.tenant_id()`;
      if (!row || !check(ctx, 'scheduling.roster.edit', { orgUnitPath: row.path }).allowed) {
        throw new RosterPermissionError("You cannot change this unit's roster.");
      }
      await setReason(tx, reason);
      await cancelAssignment(tx, assignmentId, reason);
    });
    revalidatePath('/roster');
    return { ok: true, message: 'Shift cancelled' };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}
