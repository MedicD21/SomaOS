'use server';
import { redirect } from 'next/navigation';
import { credentialExpiry, type Validity } from '@soma/schedule-engine';
import { assignmentSchema, memberCredentialSchema, memberSchema, standingSeatSchema } from '@soma/validators';
import { z } from 'zod';
import type { ActionResult } from '@/server/actions';
import { ActionError, runAdmin, zodFieldErrors } from '@/server/actions';
import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { customFromForm, loadFieldDefs, validateCustom } from '@/server/custom-fields';

function readMember(form: FormData) {
  return memberSchema.safeParse({
    firstName: form.get('firstName'), lastName: form.get('lastName'), preferredName: form.get('preferredName'),
    employeeNumber: form.get('employeeNumber'), email: form.get('email'), phone: form.get('phone'),
    rankId: form.get('rankId'), employmentType: form.get('employmentType'),
    hireDate: form.get('hireDate'), seniorityDate: form.get('seniorityDate'),
  });
}

async function customValues(form: FormData, existing: Record<string, unknown> = {}) {
  const ctx = await getRequestContext();
  const canSeeSensitive = hasAny(ctx, 'admin.members.manage');
  const defs = (await withCtxDb(ctx, (tx) => loadFieldDefs(tx, 'member'))).filter((d) => canSeeSensitive || !d.sensitivity);
  return validateCustom(defs, customFromForm(defs, form), existing);
}

export async function createMember(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = readMember(form);
  const custom = await customValues(form);
  if (!parsed.success || !custom.ok) {
    const base = parsed.success ? { fieldErrors: {} } : zodFieldErrors(parsed.error.issues);
    return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: { ...base.fieldErrors, ...(custom.ok ? {} : custom.fieldErrors) } };
  }
  const m = parsed.data;
  return runAdmin('admin.members.manage', form, async (tx) => {
    await tx`insert into members (tenant_id, first_name, last_name, preferred_name, employee_number, email, phone, rank_id,
               employment_type, hire_date, seniority_date, custom)
             values (app.tenant_id(), ${m.firstName}, ${m.lastName}, ${m.preferredName}, ${m.employeeNumber}, ${m.email}, ${m.phone},
               ${m.rankId}, ${m.employmentType}, ${m.hireDate}, ${m.seniorityDate}, ${tx.json(custom.value as never)})`;
    return `Added ${m.firstName} ${m.lastName}`;
  });
}

export async function updateMember(id: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = readMember(form);
  const ctx = await getRequestContext();
  const [existing] = await withCtxDb(ctx, (tx) => tx<{ custom: Record<string, unknown> }[]>`select custom from members where id = ${id}`);
  const custom = await customValues(form, existing?.custom ?? {});
  if (!parsed.success || !custom.ok) {
    const base = parsed.success ? { fieldErrors: {} } : zodFieldErrors(parsed.error.issues);
    return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: { ...base.fieldErrors, ...(custom.ok ? {} : custom.fieldErrors) } };
  }
  const m = parsed.data;
  const status = String(form.get('status') ?? 'active');
  return runAdmin('admin.members.manage', form, async (tx) => {
    await tx`update members set first_name = ${m.firstName}, last_name = ${m.lastName}, preferred_name = ${m.preferredName},
               employee_number = ${m.employeeNumber}, email = ${m.email}, phone = ${m.phone}, rank_id = ${m.rankId},
               employment_type = ${m.employmentType}, hire_date = ${m.hireDate}, seniority_date = ${m.seniorityDate},
               status = ${status}, custom = ${tx.json(custom.value as never)}
             where id = ${id}`;
    return 'Saved';
  });
}

export async function addAssignment(memberId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = assignmentSchema.safeParse({ orgUnitId: form.get('orgUnitId'), shiftId: form.get('shiftId'), effectiveFrom: form.get('effectiveFrom') });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const a = parsed.data;
  return runAdmin('admin.members.manage', form, async (tx) => {
    // Close the open-ended current primary assignment the day the new one starts.
    await tx`update member_assignments set effective = daterange(lower(effective), ${a.effectiveFrom}::date)
             where member_id = ${memberId} and is_primary and upper_inf(effective) and lower(effective) < ${a.effectiveFrom}::date`;
    await tx`insert into member_assignments (tenant_id, member_id, org_unit_id, shift_id, effective)
             values (app.tenant_id(), ${memberId}, ${a.orgUnitId}, ${a.shiftId}, daterange(${a.effectiveFrom}::date, null))`;
    return 'Assignment added';
  });
}

export async function openMember(form: FormData): Promise<void> {
  redirect(`/admin/members/${String(form.get('id'))}`);
}

export async function sendInvite(memberId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  return runAdmin('admin.members.manage', form, async (tx) => {
    await tx`select app.enqueue_invite(${memberId})`;
    return 'Invitation queued — it will be emailed shortly.';
  });
}

const uuid = z.uuid();

/**
 * Starts a standing (regular) seat on date D. A seat the member holds across D is ended at D
 * in the same transaction; a later one makes the exclusion constraint reject the change.
 */
export async function saveStandingSeat(memberId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const kelly = String(form.get('kellyGroup') ?? '').trim();
  const parsed = standingSeatSchema.safeParse({
    memberId,
    seatId: form.get('seatId'),
    platoonShiftId: form.get('platoonShiftId'),
    kellyGroup: kelly === '' ? undefined : kelly,
    effectiveFrom: form.get('effectiveFrom'),
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const v = parsed.data;
  return runAdmin('scheduling.config.manage', form, async (tx) => {
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
    return `Standing seat saved from ${v.effectiveFrom}`;
  });
}

/** Records a credential; the expiry is computed here from the type's validity, never taken from the form. */
export async function addCredential(memberId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const number = String(form.get('number') ?? '').trim();
  const parsed = memberCredentialSchema.safeParse({
    memberId,
    typeId: form.get('typeId'),
    issuedOn: form.get('issuedOn'),
    number: number || undefined,
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const c = parsed.data;
  return runAdmin('credentials.manage', form, async (tx) => {
    const [type] = await tx<{ label: string; validity: Validity }[]>`
      select label, validity from credential_types where id = ${c.typeId} and tenant_id = app.tenant_id() and status = 'active'`;
    if (!type) throw new ActionError('That credential type is not available.');
    const expiresOn = credentialExpiry(type.validity, c.issuedOn);
    await tx`insert into member_credentials (tenant_id, member_id, type_id, number, issued_on, expires_on)
             values (app.tenant_id(), ${c.memberId}, ${c.typeId}, ${c.number ?? null}, ${c.issuedOn}, ${expiresOn})`;
    return `Added ${type.label}`;
  });
}

export async function revokeCredential(credentialId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  if (!uuid.safeParse(credentialId).success) return { ok: false, message: 'That credential was not found.' };
  return runAdmin('credentials.manage', form, async (tx) => {
    const rows = await tx`update member_credentials set status = 'revoked'
                          where id = ${credentialId} and tenant_id = app.tenant_id() and status = 'active' returning id`;
    if (rows.length === 0) throw new ActionError('That credential was not found or is already revoked.');
    return 'Credential revoked';
  });
}
