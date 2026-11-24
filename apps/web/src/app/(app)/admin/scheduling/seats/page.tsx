import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { SeatForm, SeatStatusForm, type Option, type SeatValues } from './forms';

export default async function SeatsPage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('scheduling')) return <Forbidden reason="Scheduling is not enabled for this department." />;
  const d = check(ctx, 'scheduling.config.manage');
  if (!d.allowed) return <Forbidden reason={d.reason} />;

  const data = await withCtxDb(ctx, async (tx) => ({
    units: [...(await tx<{ id: string; name: string; path: string; type: string }[]>`
      select ou.id, ou.name, ou.path::text as path, t.label as type
      from org_units ou join org_unit_types t on t.id = ou.type_id
      where ou.status = 'active' order by ou.path`)],
    seats: [...(await tx<{ id: string; org_unit_id: string; label: string; sort: number; required: boolean; min_rank_id: string | null;
                          acting_allowed: boolean; status: string; groups: string[][] | null }[]>`
      select s.id, s.org_unit_id, s.label, s.sort, s.required, s.min_rank_id, s.acting_allowed, s.status,
             (select json_agg(g.ids order by g.group_no)
                from (select group_no, json_agg(credential_type_id order by credential_type_id) as ids
                      from seat_requirements where seat_id = s.id group by group_no) g) as groups
      from seats s order by s.status, s.sort, s.label`)],
    ranks: [...(await tx<Option[]>`select id, label from ranks order by sort`)],
    types: [...(await tx<{ id: string; label: string; status: string }[]>`select id, label, status from credential_types order by label`)],
  }));

  const typeLabel = new Map(data.types.map((ty) => [ty.id, ty.label]));
  const rankLabel = new Map(data.ranks.map((r) => [r.id, r.label]));
  const activeTypes: Option[] = data.types.filter((ty) => ty.status === 'active').map(({ id, label }) => ({ id, label }));
  const unitOptions: Option[] = data.units.map((u) => ({ id: u.id, label: u.name }));
  const seats: SeatValues[] = data.seats.map((s) => ({
    id: s.id, orgUnitId: s.org_unit_id, label: s.label, sort: s.sort, required: s.required, minRankId: s.min_rank_id,
    actingAllowed: s.acting_allowed, status: s.status, groups: s.groups ?? [],
  }));
  const unitsWithSeats = data.units.filter((u) => seats.some((s) => s.orgUnitId === u.id));
  const requirements = (s: SeatValues) =>
    s.groups.length === 0 ? 'None' : s.groups.map((g) => g.map((id) => typeLabel.get(id) ?? '?').join(' or ')).join(' and ');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Seats</h1>
      <Card title="Add a seat">
        {unitOptions.length === 0 ? <p className="text-muted">Create org units first.</p> : (
          <SeatForm units={unitOptions} ranks={data.ranks} types={activeTypes} />
        )}
      </Card>
      {unitsWithSeats.length === 0 && <Card><p className="text-muted">No seats yet.</p></Card>}
      {unitsWithSeats.map((u) => (
        <section key={u.id} aria-labelledby={`unit-${u.id}`} className="rounded-lg border border-line bg-surface p-4 shadow-sm sm:p-6">
          <h2 id={`unit-${u.id}`} className="mb-3 text-lg font-semibold">{u.name}</h2>
          <div className="relative overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Seats on {u.name} ({u.type})</caption>
              <thead>
                <tr>
                  <th scope="col" className="py-2 pr-3">Seat</th>
                  <th scope="col" className="pr-3">Requires</th>
                  <th scope="col" className="pr-3">Minimum rank</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {seats.filter((s) => s.orgUnitId === u.id).map((s) => (
                  <tr key={s.id} className="border-t border-line align-top">
                    <th scope="row" className="py-2 pr-3 font-medium">
                      {s.label}
                      <span className="block text-xs font-normal text-muted">
                        {[`#${s.sort}`, s.required ? 'Required' : 'Optional', s.status === 'archived' ? 'Archived' : null].filter(Boolean).join(' · ')}
                      </span>
                    </th>
                    <td className="py-2 pr-3">{requirements(s)}</td>
                    <td className="py-2 pr-3">
                      {s.minRankId ? rankLabel.get(s.minRankId) : '—'}
                      {s.minRankId && s.actingAllowed && <span className="block text-xs text-muted">Acting allowed</span>}
                    </td>
                    <td className="space-y-2 py-2">
                      <details>
                        <summary className="inline-flex min-h-11 cursor-pointer items-center underline">Edit {s.label}</summary>
                        <SeatForm seat={s} units={unitOptions} ranks={data.ranks} types={activeTypes} />
                      </details>
                      <SeatStatusForm seat={s} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
