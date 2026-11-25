/** "Tue, Mar 3, 09:00–11:00" in the session's own time zone. */
export function sessionWhen(s: { startsAt: Date; endsAt: Date; tz: string }): string {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: s.tz, weekday: 'short', month: 'short', day: 'numeric' }).format(s.startsAt);
  const time = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: s.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return `${day}, ${time(s.startsAt)}–${time(s.endsAt)}`;
}

export const SESSION_STATUS_LABEL: Record<string, string> = { draft: 'Draft', scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled' };
