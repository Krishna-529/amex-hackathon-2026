'use client';

import { useWorld } from '@/components/WorldProvider';
import HistoryTable from '@/components/HistoryTable';
import { HistorySkeleton } from '@/components/PageSkeletons';

export default function HistoryPage() {
  const { schedule } = useWorld();

  if (!schedule) return <HistorySkeleton />;

  const cancelled = schedule.past.filter((p) => p.outcome === 'cancelled').length;
  const delayed = schedule.past.filter((p) => p.outcome === 'delayed').length;

  return (
    <div className="skeleton">
      <div className="page-h">
        <h1>History</h1>
        <p>
          {schedule.past.length} flights. {cancelled} cancelled, {delayed} delayed — every one of them
          handled before you had to ask.
        </p>
      </div>
      <HistoryTable rows={schedule.past} />
    </div>
  );
}
