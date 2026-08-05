import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import {Suspense} from 'react';
import {Inter, Newsreader} from 'next/font/google';
import {cn} from '@/lib/utils';
import {getDigests, usingMock} from '@/src/data';
import {DashboardShell} from '@/components/analyst/dashboard-shell';
import {IntroSplash} from '@/components/analyst/intro-splash';
import './globals.css';

// Coop identity: Inter for UI/data, Newsreader for the editorial serif display.
const sans = Inter({subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans'});
const serif = Newsreader({subsets: ['latin'], weight: ['300', '400', '500', '600'], style: ['normal', 'italic'], variable: '--font-serif'});

export const metadata: Metadata = {
  title: 'Coop · BrandOS — Zoomy',
  description: 'The Brand Operating System — store-ops analytics for Zoomy across Shopee, Lazada and the website.',
};

export default async function RootLayout({children}: {children: ReactNode}) {
  // The shell (header + week sidebar + tab nav) is shared across all tab routes,
  // so it fetches the week list once here; getDigests() is React-cached so the
  // page doesn't re-fetch. useSearchParams inside the shell needs a Suspense boundary.
  const digests = await getDigests();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Seed the theme class before first paint (no flash). Coop is light-first
            (cream canvas), so default to light unless the user explicitly chose dark. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('zoomy-theme');document.documentElement.classList.toggle('dark',t==='dark');}catch(e){}})();",
          }}
        />
      </head>
      <body className={cn(sans.variable, serif.variable, 'font-sans antialiased')}>
        <IntroSplash />
        <Suspense>
          <DashboardShell digests={digests} usingMock={usingMock()}>
            {children}
          </DashboardShell>
        </Suspense>
      </body>
    </html>
  );
}
