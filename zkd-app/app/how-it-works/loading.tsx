import { HowItWorksSkeleton } from '@/components/PageSkeletons';

/**
 * Static copy, so there is no data wait to cover — but see the note in
 * app/ops/loading.tsx: inheriting the light home skeleton onto a dark route is
 * the thing being avoided.
 */
export default function Loading() {
  return <HowItWorksSkeleton />;
}
