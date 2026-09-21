import {NextResponse} from 'next/server';
import {auth} from '@/auth';
import {devAuthEnabled} from '@/src/dev-auth';

// Protect every page. Excludes: all API routes (the chat route guards itself
// with auth() so a fetch gets a 401 not an HTML redirect), the sign-in page,
// Next internals, static files, and the PWA metadata assets (manifest + icons)
// — a manifest that 302s to /signin isn't installable, and browsers fetch icons
// without credentials. These carry no secrets (app name, colours, brand tiles).
//
// Local dev with DEV_AUTH_BYPASS lets every request through (no sign-in gate);
// everywhere else NextAuth's middleware protects pages. The bypass can't reach
// a deployment — see src/dev-auth.ts.
export default devAuthEnabled() ? () => NextResponse.next() : auth;

export const config = {
  matcher: ['/((?!api|signin|_next/static|_next/image|favicon.ico|manifest.webmanifest|pwa-icon|apple-icon|icon.svg|sw.js).*)'],
};
