import type {MetadataRoute} from 'next';

// Web app manifest — makes Coop installable (Add to Home Screen) and launch in a
// standalone window with the right icons and Coop-canvas chrome. Next links it as
// <link rel="manifest"> automatically; it's inert on desktop browsers. The service
// worker (offline shell) is a separate, later step — this alone gives installability
// + standalone display on iOS and Android.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Coop · BrandOS',
    short_name: 'Coop',
    description: 'The Brand Operating System — store-ops analytics for Zoomy.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F8F4F1',
    theme_color: '#F8F4F1',
    icons: [
      {src: '/pwa-icon/192', sizes: '192x192', type: 'image/png', purpose: 'any'},
      {src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any'},
      {src: '/pwa-icon/512?maskable=1', sizes: '512x512', type: 'image/png', purpose: 'maskable'},
    ],
  };
}
