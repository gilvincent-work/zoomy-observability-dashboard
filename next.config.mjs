import withSerwistInit from '@serwist/next';

/** @type {import('next').NextConfig} */
const nextConfig = {};

// Service worker (Serwist). Precaches static build assets only; never caches
// navigations or data (see app/sw.ts). Disabled in dev to avoid stale-cache pain.
const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  cacheOnNavigation: false,
  register: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === 'development',
});

export default withSerwist(nextConfig);
