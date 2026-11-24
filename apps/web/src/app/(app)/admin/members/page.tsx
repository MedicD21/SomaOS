import Link from 'next/link';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, hasAny, t, withCtxDb } from '@/server/context';
import { loadFieldDefs } from '@/server/custom-fields';
import { createMember } from './actions';
import { MemberForm } from './member-form';

type Row = { id: string; first_name: string; last_name: string; employee_number: string | null; rank: string | null; status: string; unit: string | null; shift: string | null };

export default async function MembersPage() {
  const ctx = await getRequestContext();
  const d = check(ctx, 'admin.members.view');
  if (!d.allowed) return <Forbidden reason={d.reason} />;
  const canManage = hasAny(ctx, 'admin.members.manage');
  const { rows, ranks, defs } = await withCtxDb(ctx, async (tx) => ({
    rows: await tx<Row[]>`
      select m.id, m.first_name, m.last_name, m.employee_number, r.label as rank, m.status, ou.name as unit, s.label as shift
      from members m
      left join ranks r on r.id = m.rank_id
      left join app.current_primary_assignment a on a.member_id = m.id
      left join org_units ou on ou.id = a.org_unit_id
      left join shifts s on s.id = a.shift_id
      order by m.last_name, m.first_name`,
    ranks: await tx<{ id: string; label: string }[]>`select id, label from ranks order by sort`,
    defs: (await loadFieldDefs(tx, 'member')).filter((f) => canManage || !f.sensitivity),
  }));
  const plural = t(ctx, 'members', 'Members');
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{plural}</h1>
      {canManage && (
        <Card title={`Add a ${t(ctx, 'member', 'member').toLowerCase()}`}>
          <MemberForm action={createMember} label="Add member" submitLabel="Add member" ranks={[...ranks]} defs={defs} />
        </Card>
      )}
      <Card title={`All ${plural.toLowerCase()}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr><th scope="col" className="py-2">Name</th><th scope="col">Employee #</th><th scope="col">Rank</th><th scope="col">{t(ctx, 'station', 'Station')}</th><th scope="col">{t(ctx, 'shift', 'Shift')}</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-t border-line">
                  <td className="py-2"><Link className="underline" href={`/admin/members/${m.id}`}>{m.last_name}, {m.first_name}</Link></td>
                  <td>{m.employee_number ?? '—'}</td><td>{m.rank ?? '—'}</td><td>{m.unit ?? '—'}</td><td>{m.shift ?? '—'}</td><td>{m.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
