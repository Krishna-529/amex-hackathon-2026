import type { Metadata } from 'next';
import './globals.css';
import SiteHeader from '@/components/SiteHeader';
import { WorldProvider } from '@/components/WorldProvider';

export const metadata: Metadata = {
  title: 'ZKD Concierge',
  description:
    'Watches every booking, detects a disruption the moment the airline files it, and rebooks your flight, hotel and ground legs inside your policy.',
  icons: {
    icon:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='10' fill='%232f7ff0'/%3E%3Crect x='10' y='10' width='12' height='12' rx='4' fill='%23080c14'/%3E%3C/svg%3E",
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
