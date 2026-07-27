import { useEffect, useState } from 'react';
import { Dashboard } from './Dashboard';
import { Push } from './Push';

export interface Policy {
  decisionId: number;
  rulePath: string;
  package: string;
  subject: string;
  allowed: boolean;
  input: any;
  result: any;
  reasons: string[];
  evalMs: number;
  timestamp: string;
}

export interface Row {
  id: string;
  title: string;
  detail: string;
  costInr: number;
  costLabel: string;
  status: string;
  tone: 'green' | 'amber' | 'rose';
  rulePath: string;
  decisionId: number;
  policy: Policy | null;
}

export interface State {
  ok: boolean;
  error?: string;
  run: { runId: string; workflowId: string; status: string; totalChargedLabel: string };
  cardMember: any;
  regulator: string;
  disruption: any;
  timeline: Row[];
  dutyOfCare: any;
  chosen: any;
  decisions: any[];
  counts: { decisions: number; allow: number; deny: number };
}

function useQuery() {
  const p = new URLSearchParams(window.location.search);
  return {
    view: p.get('view') ?? 'dashboard',
    expand: p.get('expand'),
    capture: p.get('capture') === '1',
  };
}

export function App() {
  const q = useQuery();
  const [state, setState] = useState<State | null>(null);
  const [push, setPush] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.capture) document.body.classList.add('capture');
    Promise.all([fetch('/api/state').then((r) => r.json()), fetch('/api/push').then((r) => r.json())])
      .then(([s, p]) => {
        if (!s.ok) setError(s.error ?? 'ledger empty');
        setState(s);
        setPush(p);
      })
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="empty">Ledger unavailable — {error}</div>;
  if (!state || !push) return <div className="empty">Reading decision ledger…</div>;

  return q.view === 'push' ? <Push push={push} /> : <Dashboard state={state} expand={q.expand} />;
}
