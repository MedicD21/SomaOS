import { localDateOf } from '@soma/schedule-engine';
import { Forbidden } from '@/components/forbidden';
import { Card } from '@/components/ui/card';
import { getRequestContext, hasAny, withCtxDb } from '@/server/context';
import { claimQualification, loadOpenShifts, loadPostableSeats } from '@/server/scheduling/open-shifts';
import { ApproveClaimForm, CancelOpenShiftForm, ClaimForm, DenyClaimForm, PostOpenShiftForm, WithdrawForm } from './forms';

function when(start: Date, end: Date, tz: string): string {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(start);
  const hours = Math.round(((end.getTime() - start.getTime()) / 3_600_000) * 100) / 100;
  return `${day} · ${hours} h`;
}

export default async function OpenShiftsPage() {
  const ctx = await getRequestContext();
  if (!ctx.tenant.enabledModules.includes('scheduling')) return <Forbidden reason="scheduling is not enabled for this department" />;
  const canClaim = hasAny(ctx, 'scheduling.openshift.claim');
  const canManage = hasAny(ctx, 'scheduling.roster.edit');
  if (!canClaim && !canManage) return <Forbidden reason="no permission to see open shifts" />;

  const data = await withCtxDb(ctx, async (tx) => {
    const shifts = await loadOpenShifts(tx);
    const blocks: Record<string, { blocks: string[] }> = {};
    for (const s of shifts) if (s.canManage) for (const c of s.claims) blocks[c.id] = { blocks: (await claimQualification(tx, c.id)).blocks };
    return { shifts: [...shifts], blocks, seats: canManage ? await loadPostableSeats(tx) : [] };
  });
  const today = localDateOf(new Date(), ctx.tenant.timezone);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Open shifts</h1>
      <p className="text-muted">
        Seats that need someone. Claim one you can work; an officer at that station approves a claim and the shift goes on your schedule.
      </p>

      {canManage && (
        <Card title="Post an open shift">
          {data.seats.length === 0 ? <p>You do not cover any seats.</p> : <PostOpenShiftForm seats={data.seats} today={today} />}
        </Card>
      )}

      {data.shifts.length === 0 ? (
        <p>There are no open shifts right now.</p>
      ) : (
        <ul aria-label="Open shifts" className="space-y-3">
          {data.shifts.map((s) => {
            const label = `${s.unit} ${s.seatLabel} ${when(s.start, s.end, s.tz)}`;
            return (
              <li key={s.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{s.unit} · {s.seatLabel}</span>
                  <span>{s.type === 'overtime' ? 'Overtime' : 'Regular'}</span>
                </div>
                <p>{when(s.start, s.end, s.tz)}</p>
                <p className="text-sm text-muted">{s.reason}</p>

                {canClaim && !s.myClaimId && <div className="mt-3"><ClaimForm id={s.id} label={label} /></div>}
                {s.myClaimId && (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm font-medium">You claimed this. Waiting for an officer.</p>
                    <WithdrawForm id={s.myClaimId} label={label} />
                  </div>
                )}

                {s.canManage && (
                  <div className="mt-3 space-y-3 border-t border-line pt-3">
                    <p className="text-sm font-medium">Claims ({s.claims.length})</p>
                    {s.claims.length === 0 ? <p className="text-sm text-muted">No claims yet.</p> : (
                      <ul aria-label={`Claims for ${label}`} className="space-y-3">
                        {s.claims.map((c) => (
                          <li key={c.id} className="rounded-md border border-line p-3">
                            <p className="font-medium">{c.memberName}</p>
                            {c.note && <p className="text-sm text-muted">{c.note}</p>}
                            {(data.blocks[c.id]?.blocks.length ?? 0) > 0 && (
                              <div role="note" className="mt-2 rounded-md border border-line p-2 text-sm">
                                <p className="font-medium">Qualification blocks</p>
                                <p>{data.blocks[c.id]!.blocks.join('; ')}</p>
                              </div>
                            )}
                            {c.mine ? <p className="mt-2 text-sm text-muted">You cannot decide your own claim.</p> : (
                              <div className="mt-2 space-y-2">
                                <ApproveClaimForm id={c.id} who={c.memberName} />
                                <DenyClaimForm id={c.id} who={c.memberName} />
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    <CancelOpenShiftForm id={s.id} label={label} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
