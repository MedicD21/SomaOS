import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { complianceCsv, loadCompliance } from '@/server/training/compliance';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** CSV of the compliance rows the caller may see (the database limits them to their scope), honouring the page's filters. */
export async function GET(req: Request): Promise<Response> {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('training') || !hasAny(ctx, 'training.compliance.view')) return new Response('Forbidden', { status: 403 });
  const url = new URL(req.url);
  const unit = url.searchParams.get('unit');
  const status = url.searchParams.get('status');
  const { rows } = await withCtxDb(ctx, (tx) => loadCompliance(tx, ctx.tenant.timezone, unit && UUID.test(unit) ? unit : null));
  const shown = status ? rows.filter((r) => r.status === status) : rows;
  return new Response(complianceCsv(shown), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="training-compliance.csv"' },
  });
}
