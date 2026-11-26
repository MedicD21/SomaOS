import 'server-only';
import {
  localDateOf, trainingCompliance,
  type ComplianceRow, type TrainingHours, type TrainingMember, type TrainingRequirement, type TrainingWindow,
} from '@soma/schedule-engine';
import type { Tx } from '@/server/db';

export type ComplianceView = ComplianceRow & { memberName: string; requirementLabel: string; categoryLabel: string };

const ORDER: Record<string, number> = { overdue: 0, due_soon: 1, on_track: 2, met: 3 };

/**
 * Who is due or overdue, for the members the caller may see (themselves, a unit, or everyone; the database decides).
 * Uses the same pure rule as the daily reminder job.
 */
export async function loadCompliance(tx: Tx, tz: string, unitId: string | null): Promise<{ today: string; rows: ComplianceView[] }> {
  const today = localDateOf(new Date(), tz);
  const members = await tx<{ member_id: string; name: string; rank_id: string | null; role_ids: string[] }[]>`
    select member_id, name, rank_id, role_ids from app.training_compliance_members(${unitId})`;
  if (members.length === 0) return { today, rows: [] };

  const reqs = await tx<{ id: string; label: string; category_id: string; category: string; rank_id: string | null; role_id: string | null; required_hours: string; span: TrainingWindow; effective_from: string; effective_to: string | null }[]>`
    select r.id, r.label, r.category_id, c.label as category, r.rank_id, r.role_id, r.required_hours::text, r.span, r.effective_from::text, r.effective_to::text
    from training_requirements r join training_categories c on c.id = r.category_id where r.archived_at is null`;
  const requirements = reqs.map((r): TrainingRequirement => ({
    id: r.id, label: r.label, categoryId: r.category_id, rankId: r.rank_id, roleId: r.role_id, requiredHours: Number(r.required_hours),
    window: r.span, effectiveFrom: r.effective_from, effectiveTo: r.effective_to,
  }));

  const ids = members.map((m) => m.member_id);
  const hours = (
    await tx<{ member_id: string; category_id: string; credited_on: string; hours: string }[]>`
      select member_id, category_id, credited_on::text, hours::text from app.training_compliance_hours(${ids}::uuid[])`
  ).map((h): TrainingHours => ({ memberId: h.member_id, categoryId: h.category_id, creditedOn: h.credited_on, hours: Number(h.hours) }));

  const people = members.map((m): TrainingMember => ({ id: m.member_id, rankId: m.rank_id, roleIds: m.role_ids }));
  const names = new Map(members.map((m) => [m.member_id, m.name]));
  const labels = new Map(reqs.map((r) => [r.id, { label: r.label, category: r.category }]));
  const rows = trainingCompliance({ requirements, members: people, hours, today })
    .map((r): ComplianceView => ({
      ...r, memberName: names.get(r.memberId) ?? '', requirementLabel: labels.get(r.requirementId)?.label ?? '', categoryLabel: labels.get(r.requirementId)?.category ?? '',
    }))
    .sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || a.memberName.localeCompare(b.memberName) || a.requirementLabel.localeCompare(b.requirementLabel));
  return { today, rows };
}

const text = (v: string): string => {
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** CSV of the rows on screen. Free text that starts with = + - @ is defused so a spreadsheet will not run it. */
export function complianceCsv(rows: ComplianceView[]): string {
  const out = ['Member,Requirement,Category,Status,Hours earned,Hours required,Hours remaining,Window start,Window end'];
  for (const r of rows) {
    out.push([text(r.memberName), text(r.requirementLabel), text(r.categoryLabel), r.status, r.earned, r.required, r.remaining, r.windowStart, r.windowEnd].join(','));
  }
  return `${out.join('\r\n')}\r\n`;
}
