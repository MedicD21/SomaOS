import { NextResponse, type NextRequest } from 'next/server';
import { ForbiddenError, getRequestContext } from '@/server/context';
import { getSignedUrl } from '@/server/files';

/** Permission-checked download: redirects to a 5-minute signed storage URL. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse('Not found', { status: 404 });
  const ctx = await getRequestContext();
  try {
    const url = await getSignedUrl(ctx, id);
    if (!url) return new NextResponse('Not found', { status: 404 });
    return NextResponse.redirect(url);
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse('Forbidden', { status: 403 });
    throw e;
  }
}
