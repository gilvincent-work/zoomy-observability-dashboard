import 'server-only';
import {auth} from '../auth';
import {DEV_SESSION, devAuthEnabled} from './dev-auth';
import {normalizeEmail} from './reports-access';

/**
 * The signed-in user's email (lower-cased), or null when there is no session. Every reports page and action starts here:
 * a null means redirect to sign-in (pages) or return an error before touching the database (actions). `auth()` is the
 * session check; the dev bypass (`next dev` + DEV_AUTH_BYPASS=true only, see dev-auth.ts) stands in as dev@localhost.
 * Never throws.
 */
export async function reportsViewerEmail(): Promise<string | null> {
  try {
    const session = devAuthEnabled() ? DEV_SESSION : await auth();
    const email = normalizeEmail(session?.user?.email);
    return email === '' ? null : email;
  } catch {
    return null;
  }
}
