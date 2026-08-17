import { HomeSkeleton } from '@/components/PageSkeletons';

/**
 * Route-level loading UI. Next.js renders this the moment a navigation to this
 * segment starts — before the page component exists — and swaps it for the page
 * when the segment is ready. It fills the gap that used to look like the nav tab
 * freezing on click.
 *
 * It renders the SAME skeleton the page's own data guard renders, so the two
 * waits (route ready, then data ready) read as one continuous placeholder
 * rather than two separate flashes.
 *
 * This one is also the fallback for any child segment without a loading.tsx of
 * its own, which is why every sibling route has one — otherwise a dark route
 * would flash this light Amex hero on the way in.
 */
export default function Loading() {
  return <HomeSkeleton />;
}
