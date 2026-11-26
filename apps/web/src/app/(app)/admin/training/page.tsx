import { localDateOf, type TrainingWindow } from '@soma/schedule-engine';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { loadCatalog } from '@/server/training/load';
import { AddCategoryForm, AddCourseForm, AddRequirementForm, ArchiveForm } from './forms';

function windowText(w: TrainingWindow): string {
  if (w.kind === 'calendar_year') return 'each calendar year';
  if (w.kind === 'rolling_months') return `any ${w.months} months`;
  return `cycle ending ${w.month}/${w.day} every ${w.years} year${w.years === 1 ? '' : 's'}`;
}

export default async function TrainingAdminPage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('training')) return <Forbidden reason="training is not enabled for this department" />;
  const d = check(ctx, 'training.course.manage');
  if (!d.allowed) return <Forbidden reason={d.reason} />;
  const cat = await withCtxDb(ctx, (tx) => loadCatalog(tx));
  const today = localDateOf(new Date(), ctx.tenant.timezone);
  const activeCats = cat.categories.filter((c) => !c.archived).map((c) => ({ id: c.id, label: c.label }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Training</h1>
      <p className="text-muted">
        Categories, courses and the hours people must earn. Archive instead of deleting. Everything here is yours to edit: the starter
        hour figures are examples, not verified ISO, state or NCCP requirements.
      </p>

      <Card title="Categories">
        <ul aria-label="Training categories" className="mb-4 space-y-2">
          {cat.categories.map((c) => (
            <li key={c.id} className="rounded-lg border border-line p-3">
              <span className="font-medium">{c.label}</span>{c.externalCode ? ` (${c.externalCode})` : ''}{c.archived ? ' · archived' : ''}
              {!c.archived && <details className="mt-1"><summary className="cursor-pointer text-sm underline">Archive</summary><ArchiveForm kind="category" id={c.id} label={c.label} /></details>}
            </li>
          ))}
        </ul>
        <AddCategoryForm />
      </Card>

      <Card title="Courses">
        <ul aria-label="Training courses" className="mb-4 space-y-2">
          {cat.courses.map((c) => (
            <li key={c.id} className="rounded-lg border border-line p-3">
              <span className="font-medium">{c.label}</span> · {c.categoryLabel} · {c.defaultHours} h
              {c.credentialLabel ? ` · grants ${c.credentialLabel} (${c.minHoursPct}% of hours)` : ''}{c.archived ? ' · archived' : ''}
              {!c.archived && <details className="mt-1"><summary className="cursor-pointer text-sm underline">Archive</summary><ArchiveForm kind="course" id={c.id} label={c.label} /></details>}
            </li>
          ))}
        </ul>
        {activeCats.length > 0 ? <AddCourseForm categories={activeCats} credentialTypes={cat.credentialTypes} /> : <p>Add a category first.</p>}
      </Card>

      <Card title="Requirements">
        <ul aria-label="Training requirements" className="mb-4 space-y-2">
          {cat.requirements.map((r) => (
            <li key={r.id} className="rounded-lg border border-line p-3">
              <span className="font-medium">{r.label}</span> · {r.requiredHours} h of {r.categoryLabel} {windowText(r.window)}
              <span className="block text-sm text-muted">
                {r.rankLabel ?? 'Everyone'}{r.roleLabel ? ` · ${r.roleLabel}` : ''} · from {r.effectiveFrom}{r.effectiveTo ? ` to ${r.effectiveTo}` : ''}{r.archived ? ' · archived' : ''}
              </span>
              {!r.archived && <details className="mt-1"><summary className="cursor-pointer text-sm underline">Archive</summary><ArchiveForm kind="requirement" id={r.id} label={r.label} /></details>}
            </li>
          ))}
        </ul>
        {activeCats.length > 0 ? <AddRequirementForm categories={activeCats} ranks={cat.ranks} roles={cat.roles} today={today} /> : <p>Add a category first.</p>}
      </Card>
    </div>
  );
}
