'use client';

import { useState } from 'react';
import { DEMO_ACCOUNTS } from '@/lib/demoAccounts';

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
    <div className="skeleton">
      <div className="page-h">
        <h1>Sign in</h1>
        <p>This is your card member account — it is how we know which trips, preferences and payment method are yours.</p>
      </div>

      {error && (
        <div className="g alert warn" style={{ display: 'flex', marginBottom: 16 }}>
          <span className="ic">!</span>
          <span className="tx">
            <span className="tt">{error}</span>
            <span className="bd">Check the address and password and try again.</span>
          </span>
        </div>
      )}

      <form onSubmit={submit} className="g panel ops-form" style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
        <h3>Card member sign in</h3>
        <input
          required
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
        />
        <input
          required
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <button className="cta" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div className="g panel">
        <h3>Demo accounts</h3>
        {DEMO_ACCOUNTS.map((a) => (
          <div className="kv" key={a.email}>
            <span className="k">{a.name}</span>
            <span className="v">
              <button
                type="button"
                onClick={() => fillDemo(a)}
                style={{ background: 'none', border: 0, color: 'var(--iris)', font: 'inherit', cursor: 'pointer', padding: 0 }}
              >
                {a.email}
              </button>
            </span>
          </div>
        ))}
        <p className="why">
          Every seeded account uses its own password — tap a name to fill the form. This is a prototype fixture,
          not how a real card member would authenticate.
        </p>
      </div>
    </div>
  );
}
