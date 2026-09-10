import {NextResponse} from 'next/server';
import {auth} from '@/auth';
import {devAuthEnabled} from '@/src/dev-auth';

// Protect every page. Excludes: all API routes (the chat route guards itself
// with auth() so a fetch gets a 401 not an HTML redirect), the sign-in page,
// Next internals, and static files.
//
// Local dev with DEV_AUTH_BYPASS lets every request through (no sign-in gate);
// everywhere else NextAuth's middleware protects pages. The bypass can't reach
// a deployment — see src/dev-auth.ts.
export default devAuthEnabled() ? () => NextResponse.next() : auth;

export const config = {
  matcher: ['/((?!api|signin|_next/static|_next/image|favicon.ico).*)'],
};
