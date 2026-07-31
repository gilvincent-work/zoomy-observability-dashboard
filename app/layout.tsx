import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import {Suspense} from 'react';
import {IBM_Plex_Sans, IBM_Plex_Mono} from 'next/font/google';
import {cn} from '@/lib/utils';
import {getDigests, usingMock} from '@/src/data';
import {DashboardShell} from '@/components/analyst/dashboard-shell';
import './globals.css';

const sans = IBM_Plex_Sans({subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans'});
const mono = IBM_Plex_Mono({subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono'});

export const metadata: Metadata = {
  title: 'Zoomy — AI store-ops analyst',
  description: 'Weekly AI store-ops analyst — insights, predictions, and recommendations',
};

export default async function RootLayout({children}: {children: ReactNode}) {
  // The shell (header + week sidebar + tab nav) is shared across all tab routes,
  // so it fetches the week list once here; getDigests() is React-cached so the
  // page doesn't re-fetch. useSearchParams inside the shell needs a Suspense boundary.
  const digests = await getDigests();
  return (
    <html lang="en">
      <body className={cn(sans.variable, mono.variable, 'font-sans antialiased')}>
        <Suspense>
          <DashboardShell digests={digests} usingMock={usingMock()}>
            {children}
          </DashboardShell>
        </Suspense>
      </body>
    </html>
  );
}
