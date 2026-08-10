import {signIn, auth} from '@/auth';
import {redirect} from 'next/navigation';

export const metadata = {title: 'Sign in · Coop'};

export default async function SignIn({searchParams}: {searchParams: {callbackUrl?: string}}) {
  const session = await auth();
  if (session?.user) redirect(searchParams.callbackUrl || '/');

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mb-1 select-none text-[26px] font-extrabold leading-none tracking-tight text-foreground">
          co<span style={{color: 'var(--primary)'}}>o</span>p
        </div>
        <p className="mb-6 text-[13px] text-muted-foreground">BrandOS — your store-ops intelligence</p>

        <form
          action={async () => {
            'use server';
            await signIn('google', {redirectTo: searchParams.callbackUrl || '/'});
          }}
        >
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center gap-2.5 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <GoogleGlyph />
            Continue with Google
          </button>
        </form>

        <p className="mt-5 text-[11px] leading-snug text-muted-foreground">Access is limited to authorized team members.</p>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}
