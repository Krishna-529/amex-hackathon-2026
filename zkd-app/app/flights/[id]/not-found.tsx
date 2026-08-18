import Link from 'next/link';

/**
 * A segment-scoped not-found for the flight detail route.
 *
 * The root `app/not-found.tsx` renders unwrapped, so once `/flights/[id]` moved
 * into the Amex skin its 404 came out as a DARK page under a light Amex header
 * — which reads as the app being broken rather than the flight being missing.
 * Next resolves the nearest `not-found.tsx` to the segment that called
 * `notFound()`, so this one takes over here and the root keeps serving the dark
 * routes unchanged.
 *
 * Reached in practice by a stale link, or a flight that has since been rebooked
 * under a new id — so the copy points somewhere useful rather than apologising.
 */
export default function FlightNotFound() {
  return (
    <div className="amex-page">
      <div className="amex-container">
        <div className="skeleton">
          <div className="page-h">
            <h1>We can&apos;t find that flight</h1>
            <p>
              It may have been rebooked under a new reference, or the link is out of date.
              Your other flights are all still being watched.
            </p>
          </div>
          <p>
            <Link href="/flights" className="back" style={{ margin: 0 }}>← All flights</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
