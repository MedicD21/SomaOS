import { redirect } from 'next/navigation';
import { Forbidden } from '@/components/forbidden';
import { getRequestContext, hasAny } from '@/server/context';
import { ADMIN_NAV } from '@/server/nav';

export default async function AdminIndex() {
  const ctx = await getRequestContext();
  const first = ADMIN_NAV.find((i) => i.anyOf.some((p) => hasAny(ctx, p)));
  if (first) redirect(first.href);
  return <Forbidden reason="no admin permissions" />;
}
