export {auth as middleware} from '@/auth';

// Protect every page. Excludes: all API routes (the chat route guards itself
// with auth() so a fetch gets a 401 not an HTML redirect), the sign-in page,
// Next internals, and static files.
export const config = {
  matcher: ['/((?!api|signin|_next/static|_next/image|favicon.ico).*)'],
};
