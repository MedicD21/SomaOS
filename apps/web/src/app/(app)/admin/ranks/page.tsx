import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { check, getRequestContext, withCtxDb } from '@/server/context';
import { RankForm } from './forms';

export default async function RanksPage() {
  const ctx = await getRequestContext();
  const d = check(ctx, 'admin.org.manage');
  if (!d.allowed) return <Forbidden reason={d.reason} />;
  const ranks = await withCtxDb(ctx, (tx) => tx<{ id: string; key: string; label: string; sort: number }[]>`select id, key, label, sort from ranks order by sort, label`);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Ranks</h1>
      <Card title="Add a rank"><RankForm /></Card>
      <Card title="Current ranks">
        <table className="w-full text-left text-sm">
          <thead><tr><th scope="col" className="py-2">Order</th><th scope="col">Rank</th><th scope="col">Key</th><th scope="col"><span className="sr-only">Edit</span></th></tr></thead>
          <tbody>
            {ranks.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="py-2">{r.sort}</td>
                <td>{r.label}</td>
                <td><code>{r.key}</code></td>
                <td><details><summary className="cursor-pointer underline">Edit {r.label}</summary><RankForm rank={r} /></details></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
