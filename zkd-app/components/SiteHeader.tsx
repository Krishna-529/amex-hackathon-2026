'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWorld } from './WorldProvider';

const NAV = [
  { href: '/flights', label: 'My flights' },
  { href: '/history', label: 'History' },
  { href: '/profile', label: 'My details' },
  { href: '/how-it-works', label: 'How it works' },
];

export default function SiteHeader() {
  const path = usePathname();
  const { status, displayName, signOut } = useWorld();

  // Anonymous or unresolved: logo only. No nav, no member identity to show —
  // there is nothing left to impersonate, because there is nothing to show.
  if (status !== 'authenticated') {
    return (
      <header className="site">
        <div className="site-in">
          <Link href="/flights" className="logo" aria-label="ZKD Concierge home">
            <svg viewBox="0 0 100 100" width="30" height="30" aria-hidden focusable="false">
              <rect width="100" height="100" rx="22" fill="#2f7ff0" />
              <polygon points="79.04,24.92 22.28,44.72 51.32,53.96 36.8,77.72" fill="#ffffff" />
            </svg>
          </Link>
          <span className="nm">ZKD Concierge</span>
        </div>
      </header>
    );
  }

  const name = displayName ?? '…';
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <header className="site">
      <div className="site-in">
        <Link href="/flights" className="logo" aria-label="ZKD Concierge home">
          <svg viewBox="0 0 100 100" width="30" height="30" aria-hidden focusable="false">
            <rect width="100" height="100" rx="22" fill="#2f7ff0" />
            <polygon points="79.04,24.92 22.28,44.72 51.32,53.96 36.8,77.72" fill="#ffffff" />
          </svg>
        </Link>
        <Link href="/flights" className="nm">ZKD Concierge</Link>
        <span className="sp" />
        <nav>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={path.startsWith(n.href) ? 'on' : ''}>
              {n.label}
            </Link>
          ))}
        </nav>
        <span className="sp" />
        <button type="button" className="hdr-btn" onClick={signOut}>Sign out</button>
        <Link href="/profile" className="who" aria-label="Your card and permissions">
          <i>{initials}</i><span>{name}</span>
        </Link>
      </div>
    </header>
  );
}
