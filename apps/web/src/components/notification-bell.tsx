import Link from 'next/link';

export function NotificationBell({ unread }: { unread: number }) {
  return (
    <Link href="/notifications" className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-sm">
      <span aria-hidden>🔔</span>
      Notifications <span className="sr-only">({unread} unread)</span>
      {unread > 0 && <span aria-hidden className="rounded-full bg-brand px-2 text-xs font-bold text-on-brand">{unread}</span>}
    </Link>
  );
}
