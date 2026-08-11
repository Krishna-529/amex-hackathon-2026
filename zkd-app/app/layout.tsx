import type { Metadata } from 'next';
import './globals.css';
import SiteHeader from '@/components/SiteHeader';
import { WorldProvider } from '@/components/WorldProvider';

export const metadata: Metadata = {
  title: 'ZKD Concierge',
  description:
    'Watches every booking, detects a disruption the moment the airline files it, and rebooks your flight, hotel and ground legs inside your policy.',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mesh" aria-hidden>
          <i className="a" />
          <i className="b" />
          <i className="c" />
        </div>
        <WorldProvider>
          <SiteHeader />
          <div className="wrap">
            <main>{children}</main>
            <footer>
              <p>
                ZKD Concierge watches every booking, detects a disruption the moment the airline
                files it, and rebooks your flight, hotel and ground legs inside your policy — then
                tells you what it did.
              </p>
            </footer>
          </div>
        </WorldProvider>
      </body>
    </html>
  );
}
