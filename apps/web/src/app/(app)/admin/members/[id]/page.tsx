import { notFound } from 'next/navigation';
import { Forbidden } from '@/components/forbidden';
import { FileList } from '@/components/file-list';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, hasAny, t, withCtxDb } from '@/server/context';
import { loadFieldDefs } from '@/server/custom-fields';
import { updateMember } from '../actions';
import { MemberForm } from '../member-form';
import { AssignmentForm } from './assignment-form';

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await getRequestContext();
  const d = check(ctx, 'admin.members.view');
  if (!d.allowed) return <Forbidden reason={d.reason} />;
  const canManage = hasAny(ctx, 'admin.members.manage');
  const data = await withCtxDb(ctx, async (tx) => {
    const [m] = await tx`
      select id, first_name, last_name, preferred_name, employee_number, email, phone, rank_id, employment_type,
             to_char(hire_date, 'YYYY-MM-DD') as hire_date, to_char(seniority_date, 'YYYY-MM-DD') as seniority_date, status, custom
      from members where id = ${id}`;
    return {
      m,
      ranks: await tx<{ id: string; label: string }[]>`select id, label from ranks order by sort`,
      defs: (await loadFieldDefs(tx, 'member')).filter((f) => canManage || !f.sensitivity),
      units: await tx<{ id: string; name: string }[]>`select id, name from org_units where status = 'active' order by path`,
      shifts: await tx<{ id: string; label: string }[]>`select id, label from shifts order by sort`,
      assignments: await tx<{ id: string; unit: string; shift: string | null; from: string; to: string | null; is_primary: boolean }[]>`
        select a.id, ou.name as unit, s.label as shift, to_char(lower(a.effective), 'YYYY-MM-DD') as "from",
               to_char(upper(a.effective) - 1, 'YYYY-MM-DD') as "to", a.is_primary
        from member_assignments a join org_units ou on ou.id = a.org_unit_id left join shifts s on s.id = a.shift_id
        where a.member_id = ${id} order by lower(a.effective) desc`,
    };
  });
  if (!data.m) notFound();
  const m = data.m;
  const name = `${m.last_name}, ${m.first_name}`;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{name}</h1>
      <Card title="Details">
        {canManage ? (
          <MemberForm
            action={updateMember.bind(null, id)} label={`Edit ${name}`} submitLabel="Save"
            ranks={[...data.ranks]} defs={data.defs}
            member={{
              firstName: m.first_name, lastName: m.last_name, preferredName: m.preferred_name, employeeNumber: m.employee_number,
              email: m.email, phone: m.phone, rankId: m.rank_id, employmentType: m.employment_type, hireDate: m.hire_date,
              seniorityDate: m.seniority_date, status: m.status, custom: m.custom ?? {},
            }}
          />
        ) : (
          <dl className="grid grid-cols-2 gap-2 text-sm"><dt>Employee #</dt><dd>{m.employee_number ?? '—'}</dd><dt>Email</dt><dd>{m.email ?? '—'}</dd></dl>
        )}
      </Card>
      <Card title="Assignments">
        <table className="mb-4 w-full text-left text-sm">
          <thead><tr><th scope="col" className="py-2">{t(ctx, 'station', 'Station')} / unit</th><th scope="col">{t(ctx, 'shift', 'Shift')}</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Primary</th></tr></thead>
          <tbody>
            {data.assignments.map((a) => (
              <tr key={a.id} className="border-t border-line"><td className="py-2">{a.unit}</td><td>{a.shift ?? '—'}</td><td>{a.from}</td><td>{a.to ?? 'open'}</td><td>{a.is_primary ? 'Yes' : 'No'}</td></tr>
            ))}
          </tbody>
        </table>
        {canManage && (
          <AssignmentForm memberId={id} units={[...data.units]} shifts={[...data.shifts]}
            unitLabel={`${t(ctx, 'station', 'Station')} or ${t(ctx, 'unit', 'unit').toLowerCase()}`} shiftLabel={t(ctx, 'shift', 'Shift')} />
        )}
      </Card>
      <FileList entity="member" entityId={id} />
    </div>
  );
}
