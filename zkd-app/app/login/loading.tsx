import { LoginSkeleton } from '@/components/PageSkeletons';

/**
 * /login is static and has no loading guard of its own, but it still needs
 * this file: without it the segment inherits app/loading.tsx and flashes the
 * home search hero on the way to the sign-in card.
 */
export default function Loading() {
  return <LoginSkeleton />;
}
