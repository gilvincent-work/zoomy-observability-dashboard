import 'server-only';
import {headers} from 'next/headers';
import {envForHost, type CoopEnv} from './coop-env';

/** The environment this request is on, from its host (x-forwarded-host first, as on Vercel). */
export async function currentEnv(): Promise<CoopEnv> {
  const h = await headers();
  return envForHost(h.get('x-forwarded-host') ?? h.get('host'));
}
