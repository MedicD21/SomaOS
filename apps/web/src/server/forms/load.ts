import 'server-only';
import type { FormField } from '@soma/validators';
import type { Tx } from '@/server/db';

export type FormDef = {
  id: string;
  key: string;
  version: number;
  label: string;
  description: string | null;
  fields: FormField[];
  requiresSignature: boolean;
  signatureStatement: string | null;
  approval: 'none' | 'officer';
  status: 'draft' | 'published' | 'retired';
};

const defSelect = (tx: Tx) => tx`
  id, key, version, label, description, fields, requires_signature as "requiresSignature",
  signature_statement as "signatureStatement", approval, status`;

/** Published forms the caller may fill in. */
export async function loadPublishedForms(tx: Tx): Promise<FormDef[]> {
  return [...(await tx<FormDef[]>`select ${defSelect(tx)} from form_definitions where status = 'published' order by label`)];
}

export async function loadPublishedForm(tx: Tx, key: string): Promise<FormDef | null> {
  const [row] = await tx<FormDef[]>`select ${defSelect(tx)} from form_definitions where status = 'published' and key = ${key}`;
  return row ?? null;
}

/** Every version of every form (managers), newest first within a key. */
export async function loadAllDefinitions(tx: Tx): Promise<FormDef[]> {
  return [...(await tx<FormDef[]>`select ${defSelect(tx)} from form_definitions order by label, key, version desc`)];
}

export type SubmissionRow = {
  id: string;
  formLabel: string;
  formKey: string;
  memberName: string;
  submittedAt: Date;
  status: string;
  approval: string;
  correctsId: string | null;
  correctedById: string | null;
  mine: boolean;
};

const submissionSelect = (tx: Tx) => tx`
  s.id, s.definition_snapshot->>'label' as "formLabel", s.definition_snapshot->>'key' as "formKey",
  m.last_name || ', ' || m.first_name as "memberName", s.submitted_at as "submittedAt", st.status,
  s.definition_snapshot->>'approval' as approval, s.corrects_id as "correctsId",
  (select c.id from form_submissions c where c.corrects_id = s.id limit 1) as "correctedById",
  s.member_id = app.my_member_id() as mine`;

/** Submissions the caller can see, newest first (their own, their station's for approvers, or all for view_all). */
export async function loadSubmissions(tx: Tx, scope: 'mine' | 'pending'): Promise<SubmissionRow[]> {
  const rows = await tx<SubmissionRow[]>`
    select ${submissionSelect(tx)}
    from form_submissions s
    join members m on m.id = s.member_id
    join form_status st on st.submission_id = s.id
    where ${scope === 'mine'
      ? tx`s.member_id = app.my_member_id()`
      : tx`s.member_id is distinct from app.my_member_id() and st.status = 'submitted' and s.definition_snapshot->>'approval' = 'officer'
           and app.can_approve_at(s.org_unit_id)
           and not exists (select 1 from form_submissions c where c.corrects_id = s.id)`}
    order by s.submitted_at desc limit 100`;
  return [...rows];
}

export type SubmissionDetail = SubmissionRow & {
  snapshot: { label: string; fields: FormField[]; requires_signature: boolean; signature_statement: string | null; version: number };
  answers: Record<string, unknown>;
  submissionHash: string;
  signatures: { id: string; method: string; typedName: string | null; imagePng: string | null; statement: string; signedAt: Date; signerName: string; hash: string }[];
  decisions: { decision: string; note: string | null; decidedAt: Date; decidedBy: string | null }[];
  canDecide: boolean;
  verified: { ok: boolean; submissionOk: boolean; signaturesOk: boolean } | null;
};

export async function loadSubmission(tx: Tx, id: string): Promise<SubmissionDetail | null> {
  const [s] = await tx<(SubmissionRow & { snapshot: SubmissionDetail['snapshot']; answers: Record<string, unknown>; submissionHash: string; orgUnitId: string | null })[]>`
    select ${submissionSelect(tx)}, s.definition_snapshot as snapshot, s.answers, s.submission_hash as "submissionHash", s.org_unit_id as "orgUnitId"
    from form_submissions s join members m on m.id = s.member_id join form_status st on st.submission_id = s.id
    where s.id = ${id}`;
  if (!s) return null;
  const signatures = await tx<SubmissionDetail['signatures']>`
    select g.id, g.method, g.typed_name as "typedName", g.image_png as "imagePng", g.statement_text as statement, g.signed_at as "signedAt",
           m.first_name || ' ' || m.last_name as "signerName", g.signature_hash as hash
    from form_signatures g join members m on m.id = g.signer_member_id where g.submission_id = ${id} order by g.signed_at`;
  const decisions = await tx<SubmissionDetail['decisions']>`
    select d.decision, d.note, d.decided_at as "decidedAt",
           (select mm.first_name || ' ' || mm.last_name from members mm where mm.user_id = d.decided_by and mm.tenant_id = d.tenant_id limit 1) as "decidedBy"
    from form_decisions d where d.submission_id = ${id} order by d.decided_at, d.id`;
  const [can] = await tx<{ ok: boolean }[]>`
    select (${s.approval} = 'officer' and app.can_approve_at(${s.orgUnitId}::uuid) and ${s.mine} = false
            and not exists (select 1 from form_decisions where submission_id = ${id})) as ok`;
  const [v] = await tx<{ ok: boolean; submission_ok: boolean; signatures_ok: boolean }[]>`select * from app.verify_submission(${id})`;
  return {
    ...s,
    signatures: [...signatures],
    decisions: [...decisions],
    canDecide: can?.ok === true,
    verified: v ? { ok: v.ok, submissionOk: v.submission_ok, signaturesOk: v.signatures_ok } : null,
  };
}
