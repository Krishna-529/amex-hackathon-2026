import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="page-h">
      <h1>We can&apos;t find that flight</h1>
      <p>It may have been rebooked, or the link is out of date.</p>
      <p style={{ marginTop: 20 }}><Link href="/flights" className="back">← All flights</Link></p>
    </div>
  );
}
