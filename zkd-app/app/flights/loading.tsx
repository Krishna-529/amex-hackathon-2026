import { FlightsSkeleton } from '@/components/PageSkeletons';

/** Shown while the /flights segment loads; the page's own `!schedule` guard
 *  then renders the identical shape while its data arrives. */
export default function Loading() {
  return <FlightsSkeleton />;
}
