import 'server-only';
import type { StandingSeatInput } from '@soma/validators';
import type { Tx } from '@/server/db';
import { ActionError } from '@/server/errors';
import { supersedeGenerated } from './generate';

/**
 * Starts a standing (regular) seat on `effectiveFrom`. A standing seat the member holds across that
 * date is ended there, and the member's future generated shifts from that date are superseded so
 * regeneration places them on the new seat. A standing seat starting on or after the date makes
 * the exclusion constraint reject the change. Needs department scheduling.config.manage and
 * scheduling.roster.edit.
 */
export async function changeStandingSeat(tx: Tx, v: StandingSeatInput): Promise<{ superseded: number }> {
  const [seat] = await tx`select 1 from seats where id = ${v.seatId} and tenant_id = app.tenant_id() and status = 'active'`;
  if (!seat) throw new ActionError('That seat is not active.');
  await tx`update standing_seats set effective = daterange(lower(effective), ${v.effectiveFrom}::date)
           where member_id = ${v.memberId} and tenant_id = app.tenant_id()
             and lower(effective) < ${v.effectiveFrom}::date
             and (upper_inf(effective) or upper(effective) > ${v.effectiveFrom}::date)`;
  // Composite foreign keys keep the member, seat and platoon inside this department.
  await tx`insert into standing_seats (tenant_id, member_id, seat_id, platoon_shift_id, kelly_group, effective)
           values (app.tenant_id(), ${v.memberId}, ${v.seatId}, ${v.platoonShiftId}, ${v.kellyGroup ?? null},
                   daterange(${v.effectiveFrom}::date, null))`;
  const superseded = await supersedeGenerated(tx, v.effectiveFrom, { memberId: v.memberId, reason: 'Regular seat changed' });
  return { superseded };
}
