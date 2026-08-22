'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWorld } from './WorldProvider';
import AmexHeader from './AmexHeader';
import { isAmexRoute } from '@/lib/amexRoutes';
import { SkLine } from './Skeletons';

const NAV = [
  { href: '/flights', label: 'My flights' },
  { href: '/history', label: 'History' },
  { href: '/profile', label: 'My details' },
];

function Mark() {
  return (
    <Link href="/flights" className="logo" aria-label="ZKD Concierge home">
      <svg viewBox="0 0 100 100" width="30" height="30" aria-hidden focusable="false">
        <rect width="100" height="100" rx="22" fill="#2f7ff0" />
        <polygon points="79.04,24.92 22.28,44.72 51.32,53.96 36.8,77.72" fill="#ffffff" />
      </svg>
    </Link>
  );
}

export default function SiteHeader() {
  const path = usePathname();
  const { status, displayName, signOut } = useWorld();

  if (isAmexRoute(path)) {
    return <AmexHeader />;
  }

  // 'loading' used to fall through to the anonymous header below, so a signed-in
  // member watched the bar flip from logo-only to a full nav a beat later. Hold
  // the authenticated shape instead — same widths, no identity claimed.
  if (status === 'loading') {
    return (
      <header className="site" aria-busy="true">
        <div className="site-in">
          <Mark />
          <span className="nm">ZKD Concierge</span>
          <span className="sp" />
          <nav aria-hidden="true">
            {NAV.map((n) => (
              <span key={n.href} style={{ padding: '7px 14px', fontSize: 14 }}>
                <SkLine w={`${(n.label.length * 0.52).toFixed(2)}em`} />
              </span>
            ))}
          </nav>
          <span className="sp" />
          <span className="hdr-btn" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center' }}>
            <SkLine w="4.5em" />
          </span>
          <span className="who" aria-hidden="true">
            <SkLine className="sk-circle" w={30} h={30} />
            <SkLine w="7em" />
          </span>
        </div>
      </header>
    );
  }

  // Anonymous: logo only. No nav, no member identity to show — there is
  // nothing left to impersonate, because there is nothing to show.
  if (status !== 'authenticated') {
    return (
      <header className="site">
        <div className="site-in">
          <Mark />
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
        <Mark />
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
        <button type="button" className="hdr-btn" onClick={signOut}>
          <svg viewBox="0 0 20 20" width="12" height="12" aria-hidden focusable="false" style={{ marginRight: 6, verticalAlign: -1 }}>
            <path d="M7.5 3H4.5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M13 6.5 16.5 10 13 13.5M16.2 10H8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Sign out
        </button>
        <Link href="/profile" className="who" aria-label="Your card and permissions">
          <i>{initials}</i><span>{name}</span>
        </Link>
      </div>
    </header>
  );
}
