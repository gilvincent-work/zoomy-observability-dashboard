'use server';

import {revalidateTag} from 'next/cache';
import {CRM_TAG} from './crm-cache';

/**
 * Drop the cached CRM reads so the next render goes back to the Worker. Bound
 * to the page's Refresh button — read-only, and it touches no customer data.
 */
export async function refreshCrm(): Promise<void> {
  revalidateTag(CRM_TAG);
}
