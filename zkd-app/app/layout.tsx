import type { Metadata } from 'next';
import './globals.css';
import SiteHeader from '@/components/SiteHeader';
import { WorldProvider } from '@/components/WorldProvider';
import ThemeToggle from '@/components/ThemeToggle';

// Runs before first paint: stamps data-theme on <html> from the saved choice
// (or the OS preference), so there is no flash of the wrong theme on load.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('zkd-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export const metadata: Metadata = {
  title: 'ZKD Concierge',
  description:
    'Watches every booking, detects a disruption the moment the airline files it, and rebooks your flight, hotel and ground legs inside your policy.',
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/brand/icon-192.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        <div className="mesh" aria-hidden>
          <i className="a" />
          <i className="b" />
          <i className="c" />
        </div>
        <WorldProvider>
          <ThemeToggle />
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
