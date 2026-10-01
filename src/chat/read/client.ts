import 'server-only';
import {createClient} from '@supabase/supabase-js';
import {createGuardedFetch, type GuardedFetchOptions, type GuardStats} from './guarded-fetch';
import {relationsForMode, type ChatReadMode, type ChatRelation} from './relations';
import type {ReadBuilder} from '../../pos-orders-read';

// The ONLY file under src/chat that imports @supabase/supabase-js (layer 2).

/** Select-builder surface for chat reads. No insert/update/upsert/delete/rpc/storage/auth. */
export interface ChatReadBuilder extends ReadBuilder {
  order(column: string, options?: {ascending?: boolean}): ChatReadBuilder;
  range(from: number, to: number): ChatReadBuilder;
  limit(count: number): ChatReadBuilder;
  eq(column: string, value: string | number | boolean): ChatReadBuilder;
  in(column: string, values: readonly (string | number)[]): ChatReadBuilder;
  gte(column: string, value: string | number): ChatReadBuilder;
  lte(column: string, value: string | number): ChatReadBuilder;
  or(filters: string): ChatReadBuilder;
}

/** Layer 3: only `from(allowedRelation).select(...)` exists on the type. */
export interface ChatReadClient {
  from(relation: ChatRelation): {select(columns: string): ChatReadBuilder};
}

export interface ChatReadClientOptions {
  mode?: ChatReadMode;
  env?: Record<string, string | undefined>;
  onTrip?: GuardedFetchOptions['onTrip'];
}

export function chatReadClient(opts: ChatReadClientOptions = {}): {client: ChatReadClient; stats: GuardStats; mode: ChatReadMode} {
  const env = opts.env ?? process.env;
  const mode = opts.mode ?? 'guarded_service';
  const url = env.SUPABASE_URL_ARCHIVE;
  // ro_role: a short-lived minted JWT (minting is a later task; just read it).
  const key = mode === 'ro_role' ? env.CHAT_RO_JWT : env.SUPABASE_SERVICE_ROLE_KEY_ARCHIVE;
  if (!url || !key) throw new Error(`chat read client: env not configured for mode ${mode}`);

  const {fetch: guarded, stats} = createGuardedFetch({
    baseUrl: url,
    relations: relationsForMode(mode).allowed,
    underlying: fetch,
    onTrip: opts.onTrip,
  });
  const supabase = createClient(url, key, {
    auth: {persistSession: false, autoRefreshToken: false},
    global: {fetch: guarded},
  });
  return {client: supabase as unknown as ChatReadClient, stats, mode};
}
