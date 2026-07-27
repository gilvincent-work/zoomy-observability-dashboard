import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Zoomy — weekly digests',
  description: 'Store-ops digest archive',
};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <span className="brand">Zoomy</span>
          <span className="topbar__sub">weekly store-ops digests</span>
        </header>
        {children}
      </body>
    </html>
  );
}
