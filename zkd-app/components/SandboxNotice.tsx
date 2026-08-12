export default function SandboxNotice({ kind }: { kind: 'flights' | 'hotels' }) {
  const label = kind === 'flights' ? 'flight search' : 'hotel search';
  return (
    <p style={{ margin: '10px 0 6px', color: 'var(--mist)', fontSize: 12, fontStyle: 'italic' }}>
      Live {label} results below — real sandbox data, not your actual route.
    </p>
  );
}
