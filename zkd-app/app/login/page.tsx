'use client';

import { useState } from 'react';
import { DEMO_ACCOUNTS } from '@/lib/demoAccounts';
import { setTabSession } from '@/lib/tabSession';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(json?.error ?? 'Something went wrong signing you in.');
        setBusy(false);
        return;
      }
      // Hard navigation, not router.push: WorldProvider lives in the server
      // layout and needs to remount to pick up the new session cleanly.
      window.location.assign('/flights');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  };

  const fillDemo = (acc: (typeof DEMO_ACCOUNTS)[number]) => {
    setEmail(acc.email);
    setPassword(acc.password);
  };

  return (
    <div className="amex-page">
      <div className="amex-login-wrap">
        <div className="amex-login-card">
          <h2>Log In to Your Account</h2>
          <p className="sub">This is your card member account — access your bookings, disruption guard, and preferences.</p>

          {error && (
            <div className="alert warn" style={{ display: 'flex', marginBottom: 16, padding: '12px 16px', borderRadius: 8 }}>
              <span className="ic" style={{ marginRight: 10, fontWeight: 'bold' }}>!</span>
              <span className="tx">
                <span className="tt" style={{ fontWeight: 600 }}>{error}</span>
                <span className="bd" style={{ display: 'block', fontSize: 12 }}>Check your email and password and try again.</span>
              </span>
            </div>
          )}

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="amex-field">
              <label>User ID or Email</label>
              <input
                required
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </div>

            <div className="amex-field">
              <label>Password</label>
              <input
                required
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            <button className="amex-btn-search" type="submit" disabled={busy} style={{ width: '100%', marginTop: 8 }}>
              {busy ? 'Signing in…' : 'Log In'}
            </button>
          </form>
        </div>

        <div className="amex-login-card">
          <h3 style={{ fontFamily: 'var(--amex-serif)', fontSize: 20, color: '#00175a', margin: '0 0 12px' }}>
            Demo Accounts
          </h3>
          {DEMO_ACCOUNTS.map((a) => (
            <div className="kv" key={a.email} style={{ borderTop: '1px solid var(--amex-border)', padding: '10px 0' }}>
              <span className="k" style={{ color: 'var(--amex-ink)', fontWeight: 500 }}>{a.name}</span>
              <span className="v">
                <button
                  type="button"
                  onClick={() => fillDemo(a)}
                  style={{ background: 'none', border: 0, color: '#006fcf', fontWeight: 600, font: 'inherit', cursor: 'pointer', padding: 0 }}
                >
                  {a.email}
                </button>
              </span>
            </div>
          ))}
          <p className="why" style={{ color: 'var(--amex-muted)', fontSize: 12, marginTop: 12, lineHeight: 1.5 }}>
            Every seeded account uses its own password — tap a name to fill the form. This is a prototype fixture,
            not how a real card member would authenticate.
          </p>
        </div>
      </div>
    </div>
  );
}
