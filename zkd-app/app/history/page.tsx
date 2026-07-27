'use client';

import { useWorld } from '@/components/WorldProvider';
import HistoryTable from '@/components/HistoryTable';

export default function HistoryPage() {
  const { world } = useWorld();
  if (!world) return <div className="page-h"><h1>History</h1></div>;

  const cancelled = world.past.filter((p) => p.outcome === 'cancelled').length;
  const delayed = world.past.filter((p) => p.outcome === 'delayed').length;

  return (
    <div className="skeleton">
      <div className="page-h">
        <h1>History</h1>
        <p>
          {world.past.length} flights. {cancelled} cancelled, {delayed} delayed — every one of them
          handled before you had to ask.
        </p>
      </div>
      <HistoryTable rows={world.past} />
    </div>
  );
}
