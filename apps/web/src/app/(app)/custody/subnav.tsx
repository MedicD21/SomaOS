import Link from 'next/link';

const LINKS = [
  { href: '/custody', label: 'Locations' },
  { href: '/custody/counts', label: 'Counts' },
  { href: '/custody/witness', label: 'Witness requests' },
  { href: '/custody/discrepancies', label: 'Discrepancies' },
  { href: '/custody/expiry', label: 'Expiry and recalls' },
];

export function CustodyNav() {
  return (
    <nav aria-label="Custody sections" className="flex flex-wrap gap-2">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm">{l.label}</Link>
      ))}
    </nav>
  );
}

export function TestModeNotice() {
  return (
    <p role="note" className="rounded-md border border-line p-3 text-sm text-muted">
      Test mode: SomaOS records custody but does not decide what the law requires. Do not rely on it for regulatory records until your counsel
      and medical director have reviewed the compliance checklist in the developer guide.
    </p>
  );
}
