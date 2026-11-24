import Link from 'next/link';
import { NotificationBell } from '@/components/notification-bell';
import { Button } from '@/components/ui/button';
import { getRequestContext } from '@/server/context';
import { visibleNav } from '@/server/nav';
import { signOut } from '../(auth)/login/actions';
import { switchTenant } from './actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext();
  const nav = visibleNav(ctx);
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:bg-surface focus:p-2">
        Skip to content
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="text-lg font-bold">SomaOS</span>
          <span data-testid="tenant-name" className="font-medium">
            {ctx.tenant.name}
          </span>
          <div className="ml-auto flex flex-wrap items-end gap-2">
            <NotificationBell unread={ctx.unreadNotifications} />
            {ctx.memberships.length > 1 && (
              <form action={switchTenant} className="flex max-w-full flex-wrap items-end gap-2">
                <label htmlFor="tenantId" className="text-sm">
                  Department
                </label>
                <select id="tenantId" name="tenantId" defaultValue={ctx.tenant.id} className="min-h-11 min-w-0 max-w-full rounded-md border border-line bg-surface px-2">
                  {ctx.memberships.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="secondary">
                  Switch
                </Button>
              </form>
            )}
            <form action={signOut}>
              <Button type="submit" variant="secondary">
                Sign out
              </Button>
            </form>
          </div>
        </div>
        <nav aria-label="Main" className="mx-auto max-w-6xl px-4 pb-2">
          <ul className="flex flex-wrap gap-4 text-sm">
            {nav.map((i) => (
              <li key={i.href}>
                <Link href={i.href} className="underline-offset-4 hover:underline">
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}
