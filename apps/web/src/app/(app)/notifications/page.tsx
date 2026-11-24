import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getRequestContext, withCtxDb } from '@/server/context';
import { markAllRead, markRead } from './actions';

type Row = { id: string; title: string; body: string | null; link: string | null; created_at: Date; read_at: Date | null };

export default async function NotificationsPage() {
  const ctx = await getRequestContext();
  const rows = await withCtxDb(ctx, (tx) => tx<Row[]>`
    select id, title, body, link, created_at, read_at from notifications order by created_at desc limit 100`);
  const unread = rows.filter((r) => !r.read_at).length;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Notifications</h1>
      {unread > 0 && <form action={markAllRead}><Button type="submit" variant="secondary">Mark all read</Button></form>}
      <Card>
        {rows.length === 0 ? <p className="text-muted">You have no notifications.</p> : (
          <ul className="divide-y divide-line">
            {rows.map((n) => (
              <li key={n.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div>
                  <p className={n.read_at ? '' : 'font-semibold'}>
                    {n.read_at ? '' : <span className="sr-only">Unread: </span>}
                    {n.link ? <Link className="underline" href={n.link}>{n.title}</Link> : n.title}
                  </p>
                  {n.body && <p className="text-sm text-muted">{n.body}</p>}
                  <p className="text-xs text-muted">{n.created_at.toLocaleString('en-US', { timeZone: ctx.tenant.timezone })}</p>
                </div>
                {!n.read_at && (
                  <form action={markRead}>
                    <input type="hidden" name="id" value={n.id} />
                    <Button type="submit" variant="secondary" aria-label={`Mark read: ${n.title}`}>Mark read</Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
