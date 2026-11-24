import Link from 'next/link';
import { getRequestContext, hasAny, t } from '@/server/context';
import { ADMIN_NAV } from '@/server/nav';

const TERM_FOR: Record<string, [string, string]> = { '/admin/shifts': ['shifts', 'Shifts'], '/admin/members': ['members', 'Members'] };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext();
  const items = ADMIN_NAV.filter((i) => i.anyOf.some((p) => hasAny(ctx, p)));
  return (
    <div className="grid gap-6 md:grid-cols-[12rem_1fr]">
      <nav aria-label="Admin">
        <ul className="space-y-1">
          {items.map((i) => {
            const term = TERM_FOR[i.href];
            return (
              <li key={i.href}>
                <Link className="block rounded px-2 py-2 hover:bg-surface" href={i.href}>
                  {term ? t(ctx, term[0], term[1]) : i.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
