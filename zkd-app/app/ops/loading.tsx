import { OpsSkeleton } from '@/components/PageSkeletons';

/**
 * Needed for the theme as much as the shape: without this file the operator
 * console inherits app/loading.tsx, which would flash a light Amex hero on the
 * way into a dark page.
 */
export default function Loading() {
  return <OpsSkeleton />;
}
