'use client';

import { useState } from 'react';

export default function OpsLoginPage() {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/ops-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(json?.error ?? 'Could not sign in to the operator console.');
        setBusy(false);
        return;
      }
      window.location.assign('/ops');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  };

  return (
    <div className="skeleton">
      <div className="page-h">
        <h1>Operator console sign-in</h1>
        <p>
          This console can trigger real pipeline actions across every member&apos;s flight — it needs its
          own credential, separate from a card member account.
        </p>
      </div>

      {error && (
        <div className="g alert warn" style={{ display: 'flex', marginBottom: 16 }}>
          <span className="ic">!</span>
          <span className="tx">
            <span className="tt">{error}</span>
            <span className="bd">Check the operator key and try again.</span>
          </span>
        </div>
      )}

      <form onSubmit={submit} className="g panel ops-form" style={{ display: 'grid', gap: 12 }}>
        <h3>Operator key</h3>
        <input
          required
          type="password"
          placeholder="Operator key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="off"
        />
        <button className="cta" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
