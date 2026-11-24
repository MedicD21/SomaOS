import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, t, withCtxDb } from '@/server/context';
import { ShiftForm } from '../ranks/forms';

export default async function ShiftsPage() {
  const ctx = await getRequestContext();
  const d = check(ctx, 'admin.org.manage');
  if (!d.allowed) return <Forbidden reason={d.reason} />;
  const plural = t(ctx, 'shifts', 'Shifts');
  const singular = t(ctx, 'shift', 'Shift');
  const shifts = await withCtxDb(ctx, (tx) => tx<{ id: string; key: string; label: string; color: string | null }[]>`select id, key, label, color from shifts order by sort, label`);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{plural}</h1>
      <Card title={`Add a ${singular.toLowerCase()}`}><ShiftForm singular={singular} /></Card>
      <Card title={`Current ${plural.toLowerCase()}`}>
        {shifts.length === 0 ? <p className="text-muted">None yet.</p> : (
          <ul className="space-y-3">
            {shifts.map((s) => (
              <li key={s.id} className="border-t border-line pt-3">
                <span className="mr-2 inline-block h-3 w-3 rounded-full" style={{ background: s.color ?? '#475569' }} aria-hidden />
                <span className="font-medium">{s.label}</span> <code className="text-sm text-muted">{s.key}</code>
                <details><summary className="cursor-pointer text-sm underline">Edit {s.label}</summary><ShiftForm shift={s} singular={singular} /></details>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
