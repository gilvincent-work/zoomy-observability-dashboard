import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

// Optional allowlist — comma-separated emails permitted to sign in. If empty,
// any Google account is allowed (fine for a private/staging URL; set it for prod).
const ALLOWED = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const {handlers, auth, signIn, signOut} = NextAuth({
  providers: [Google],
  pages: {signIn: '/signin'},
  callbacks: {
    // Gate who may sign in.
    signIn({profile}) {
      const email = profile?.email?.toLowerCase();
      if (!email) return false;
      return ALLOWED.length === 0 || ALLOWED.includes(email);
    },
    // Used by the middleware export to protect pages.
    authorized({auth}) {
      return Boolean(auth?.user);
    },
  },
});
