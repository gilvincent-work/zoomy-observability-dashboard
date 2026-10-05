'use server';

import {cookies} from 'next/headers';
import {revalidatePath} from 'next/cache';
import {COMPANY_COOKIE} from '@/src/active-context';

// Persist the switcher's choice as a cookie. This is only a HINT: every data path
// re-resolves it against the user's real memberships (resolveActive), so setting a
// company the user doesn't belong to simply falls back to their first membership —
// it can never grant access. We validate the slug shape to keep the cookie clean.
export async function setActiveCompany(slug: string): Promise<void> {
  const clean = /^[a-z0-9_-]{1,64}$/.test(slug) ? slug : '';
  const store = await cookies();
  if (clean) {
    store.set(COMPANY_COOKIE, clean, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production', // https in prod; allow http locally
    });
  }
  revalidatePath('/', 'layout');
}
