'use server';
import { seatSchema } from '@soma/validators';
import { z } from 'zod';
import type { ActionResult } from '@/server/actions';
import { ActionError, runAdmin, zodFieldErrors } from '@/server/actions';

const uuid = z.uuid();

/** Requirement groups arrive as `group.<n>` checkbox lists; empty groups are dropped. */
function readGroups(form: FormData): string[][] {
  const byGroup = new Map<number, Set<string>>();
  for (const [name, value] of form.entries()) {
    const m = /^group\.(\d{1,2})$/.exec(name);
    if (!m || typeof value !== 'string') continue;
    const n = Number(m[1]);
    byGroup.set(n, (byGroup.get(n) ?? new Set()).add(value));
  }
  return [...byGroup.entries()].sort(([a], [b]) => a - b).map(([, ids]) => [...ids]).filter((g) => g.length > 0);
}

export async function saveSeat(id: string | null, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  if (id !== null && !uuid.safeParse(id).success) return { ok: false, message: 'Unknown seat.' };
  const parsed = seatSchema.safeParse({
    orgUnitId: form.get('orgUnitId'),
    label: form.get('label'),
    sort: form.get('sort') || 0,
    // FormData checkboxes: present ("on") when checked, absent otherwise.
    required: form.get('required') === 'on',
    minRankId: form.get('minRankId'),
    actingAllowed: form.get('actingAllowed') === 'on',
    requirementGroups: readGroups(form),
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const s = parsed.data;
  return runAdmin('scheduling.config.manage', form, async (tx) => {
    let seatId = id;
    // Composite (tenant_id, …) foreign keys reject units, ranks and credential types from another department.
    if (seatId) {
      const rows = await tx`update seats set org_unit_id = ${s.orgUnitId}, label = ${s.label}, sort = ${s.sort}, required = ${s.required},
                              min_rank_id = ${s.minRankId ?? null}, acting_allowed = ${s.actingAllowed}
                            where id = ${seatId} and tenant_id = app.tenant_id() returning id`;
      if (rows.length === 0) throw new ActionError('That seat was not found.');
      await tx`delete from seat_requirements where seat_id = ${seatId} and tenant_id = app.tenant_id()`;
    } else {
      const [row] = await tx<{ id: string }[]>`
        insert into seats (tenant_id, org_unit_id, label, sort, required, min_rank_id, acting_allowed)
        values (app.tenant_id(), ${s.orgUnitId}, ${s.label}, ${s.sort}, ${s.required}, ${s.minRankId ?? null}, ${s.actingAllowed})
        returning id`;
      seatId = row!.id;
    }
    const reqs = s.requirementGroups.flatMap((g, i) => g.map((typeId) => ({ group_no: i + 1, credential_type_id: typeId })));
    if (reqs.length > 0) {
      await tx`insert into seat_requirements (tenant_id, seat_id, group_no, credential_type_id)
               select app.tenant_id(), ${seatId}, r.group_no, r.credential_type_id
               from jsonb_to_recordset(${tx.json(reqs)}::jsonb) as r(group_no int, credential_type_id uuid)`;
    }
    return id ? 'Saved' : `Added ${s.label}`;
  });
}

export async function setSeatStatus(id: string, status: 'active' | 'archived', _prev: ActionResult, form: FormData): Promise<ActionResult> {
  if (!uuid.safeParse(id).success || !['active', 'archived'].includes(status)) return { ok: false, message: 'Unknown seat.' };
  return runAdmin('scheduling.config.manage', form, async (tx) => {
    const rows = await tx`update seats set status = ${status} where id = ${id} and tenant_id = app.tenant_id() returning label`;
    if (rows.length === 0) throw new ActionError('That seat was not found.');
    return status === 'archived' ? `Archived ${rows[0]!.label}` : `Restored ${rows[0]!.label}`;
  });
}
