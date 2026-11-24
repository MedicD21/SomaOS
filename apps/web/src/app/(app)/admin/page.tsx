import { redirect } from 'next/navigation';
import { Forbidden } from '@/components/forbidden';
import { getRequestContext } from '@/server/context';
import { visibleAdminNav } from '@/server/nav';

export default async function AdminIndex() {
  const ctx = await getRequestContext();
  const first = visibleAdminNav(ctx)[0];
  if (first) redirect(first.href);
  return <Forbidden reason="no admin permissions" />;
}
