import { FlightDetailSkeleton } from '@/components/PageSkeletons';

/** Its own boundary, so opening a flight does not fall back to the /flights
 *  list skeleton on the way in. */
export default function Loading() {
  return <FlightDetailSkeleton />;
}
