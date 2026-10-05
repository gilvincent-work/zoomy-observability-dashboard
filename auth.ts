import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import {fetchMemberships, type Membership} from '@/src/company';

// Optional allowlist — comma-separated emails permitted to sign in. If empty,
// any Google account is allowed (fine for a private/staging URL; set it for prod).
const ALLOWED = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Record a Coop sign-in into pos_dashboard_users so the low-stock email can reach
// everyone who actually uses the dashboard. Fires in the Node OAuth-callback route
// (never the edge middleware). Fail-soft: a logging hiccup must never block login.
// Uses a direct PostgREST upsert with the archive service-role key — no server-only
// import (which would pull Node code into the edge middleware bundle).
async function recordSignIn(email?: string | null) {
  const addr = email?.toLowerCase();
  const url = process.env.SUPABASE_URL_ARCHIVE;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY_ARCHIVE;
  if (!addr || !url || !key) return;
  try {
    await fetch(`${url}/rest/v1/pos_dashboard_users?on_conflict=email`, {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({email: addr, last_seen: new Date().toISOString()}),
    });
  } catch {
    // never block sign-in on a logging failure
  }
}

export const {handlers, auth, signIn, signOut} = NextAuth({
  providers: [Google],
  pages: {signIn: '/signin'},
  callbacks: {
    // Gate who may sign in. Two allowed paths during the tenancy migration:
    //   1. ALLOWED_EMAILS (legacy) — kept so no current user loses access.
    //   2. membership in company_users (new) — anyone provisioned into a company.
    // An empty ALLOWED_EMAILS still means "any Google account" (fine for staging).
    async signIn({profile}) {
      const email = profile?.email?.toLowerCase();
      if (!email) return false;
      if (ALLOWED.length === 0 || ALLOWED.includes(email)) return true;
      const memberships = await fetchMemberships(email);
      return memberships.length > 0;
    },
    // On sign-in, attach the user's tenant memberships to the JWT so pages can
    // resolve the active company without a per-request DB hit. `user` is only
    // present at sign-in; normal requests skip the fetch (edge-safe).
    async jwt({token, user, profile}) {
      if (user) {
        const email = (profile?.email ?? user.email ?? token.email ?? '').toLowerCase();
        (token as {memberships?: Membership[]}).memberships = await fetchMemberships(email);
      }
      return token;
    },
    // Surface memberships on the session for Server Components (read via
    // src/company.ts → resolveActive to get the active company + role).
    session({session, token}) {
      (session as {memberships?: Membership[]}).memberships =
        (token as {memberships?: Membership[]}).memberships ?? [];
      return session;
    },
    // Used by the middleware export to protect pages.
    authorized({auth}) {
      return Boolean(auth?.user);
    },
  },
  events: {
    // A successful sign-in — capture the email for the alert recipient list.
    signIn({user}) {
      return recordSignIn(user?.email);
    },
  },
});
