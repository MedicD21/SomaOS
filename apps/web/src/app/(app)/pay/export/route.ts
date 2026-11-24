import { NextResponse, type NextRequest } from 'next/server';
import { localDateOf } from '@soma/schedule-engine';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { payCsv } from '@/server/pay/csv';
import { loadPayPeriod, payPeriodFor } from '@/server/pay/load';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** CSV of one pay period (one row per member and pay code). Needs department-wide pay.view. */
export async function GET(request: NextRequest) {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('pay')) return new NextResponse('Not found', { status: 404 });
  if (!check(ctx, 'pay.view').allowed && !check(ctx, 'pay.manage').allowed) return new NextResponse('Forbidden', { status: 403 });

  const start = request.nextUrl.searchParams.get('start') ?? '';
  const date = ISO.test(start) ? start : localDateOf(new Date(), ctx.tenant.timezone);
  const data = await withCtxDb(ctx, async (tx) => {
    const period = await payPeriodFor(tx, date);
    if (!period) return null;
    const codes = await tx<{ key: string; export_code: string | null }[]>`select key, export_code from pay_codes`;
    return { result: await loadPayPeriod(tx, period), codes: new Map(codes.map((c) => [c.key, c.export_code])) };
  });
  if (!data) return new NextResponse('No approved pay rules for that date', { status: 404 });

  return new NextResponse(payCsv(data.result, data.codes), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="pay-${data.result.period.start}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
