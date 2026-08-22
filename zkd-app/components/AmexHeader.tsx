'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWorld } from './WorldProvider';
import { SkLine } from './Skeletons';

/**
 * The Amex-style two-tier header (white account bar + blue "TRAVEL" bar),
 * used only on the three routes in lib/amexRoutes.ts. Every nav target is a
 * real existing route — no fabricated links standing in for Amex's other
 * product lines (Cards, Banking, etc.), which this app doesn't have.
 */
export default function AmexHeader() {
  const path = usePathname();
  const { status, displayName, signOut } = useWorld();
  const authed = status === 'authenticated';
  // Until /api/auth/me answers we know neither way. Showing "Log In" and then
  // swapping it for a name is a claim we can't back yet, and it moves the bar.
  const loading = status === 'loading';

  return (
    <header className="amex-header" aria-busy={loading || undefined}>
      <div className="amex-topbar">
        <Link href="/" className="amex-mark" aria-label="ZKD Concierge home">
          <span className="box">
            <svg viewBox="0 0 100 100" width="18" height="18" aria-hidden focusable="false">
              <polygon points="79.04,24.92 22.28,44.72 51.32,53.96 36.8,77.72" fill="#ffffff" />
            </svg>
          </span>
          <span className="wd">ZKD Concierge</span>
        </Link>
        <span className="sp" />
        {loading ? (
          <div className="amex-who" aria-hidden="true">
            <SkLine w="10em" />
            <SkLine w="5em" h="2.3em" style={{ borderRadius: 99 }} />
          </div>
        ) : authed ? (
          <div className="amex-who">
            <span className="avatar" aria-hidden="true">
              {(displayName ?? '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
            </span>
            <span className="nm">{displayName ?? '…'}</span>
            <button type="button" onClick={signOut}>
              <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden focusable="false">
                <path d="M7.5 3H4.5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M13 6.5 16.5 10 13 13.5M16.2 10H8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Sign out
            </button>
          </div>
        ) : (
          <Link href="/login" className="amex-signin">Log In</Link>
        )}
      </div>
      <div className="amex-subbar">
        <div className="amex-subbar-in">
          <span className="wd">TRAVEL</span>
          <nav>
            <Link href="/" className={path === '/' ? 'on' : ''}>Book</Link>
            {loading && (
              <span aria-hidden="true" style={{ display: 'flex', gap: 20 }}>
                <SkLine w="5em" /><SkLine w="4.5em" />
              </span>
            )}
            {authed && <Link href="/flights" className={path === '/flights' ? 'on' : ''}>My Trips</Link>}
            {authed && <Link href="/history">History</Link>}
          </nav>
          <span className="sp" />
          <span className="amex-welcome">
            {loading
              ? <SkLine w="10em" />
              : authed ? `Welcome, ${displayName ?? 'Traveler'}` : 'Welcome, Traveler'}
          </span>
        </div>
      </div>
    </header>
  );
}
