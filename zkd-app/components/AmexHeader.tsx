'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWorld } from './WorldProvider';

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

  return (
    <header className="amex-header">
      <div className="amex-topbar">
        <Link href="/" className="amex-mark" aria-label="ZKD Concierge home">
          <span className="box">
            <svg viewBox="0 0 100 100" width="18" height="18" aria-hidden focusable="false">
              <polygon points="79.04,24.92 22.28,44.72 51.32,53.96 36.8,77.72" fill="#ffffff" />
            </svg>
          </span>
          <span className="wd">ZKD Concierge</span>
        </Link>
        <nav>
          <Link href="/how-it-works">How it works</Link>
        </nav>
        <span className="sp" />
        {authed ? (
          <div className="amex-who">
            <span>Welcome, {displayName ?? '…'}</span>
            <button type="button" onClick={signOut}>Sign out</button>
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
            {authed && <Link href="/flights" className={path === '/flights' ? 'on' : ''}>My Trips</Link>}
            {authed && <Link href="/history">History</Link>}
          </nav>
          <span className="sp" />
          <span className="amex-welcome">{authed ? `Welcome, ${displayName ?? 'Traveler'}` : 'Welcome, Traveler'}</span>
        </div>
      </div>
    </header>
  );
}
