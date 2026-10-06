'use server';

import {cookies} from 'next/headers';
import {revalidatePath} from 'next/cache';
import {VIEW_COOKIE} from '@/src/active-context';

// Persist the switcher's choice of active VIEW (a company id, or the `coop_admin`
// sentinel) as a cookie. A HINT only: every data path re-resolves it against the
// user's real memberships (resolveActive), so picking a view you don't hold simply
// falls back to one you do — it can never grant access. Slug-shape validated.
export async function setActiveView(viewKey: string): Promise<void> {
  const clean = /^[a-z0-9_-]{1,64}$/.test(viewKey) ? viewKey : '';
  if (clean) {
    const store = await cookies();
    store.set(VIEW_COOKIE, clean, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    });
  }
  revalidatePath('/', 'layout');
}
