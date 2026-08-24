import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ZKD Concierge — Rebooking Workflows',
  description: 'Two workflows: the app, and the rebooking component — traced from source.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
