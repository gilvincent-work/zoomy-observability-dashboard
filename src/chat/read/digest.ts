import {maskDigestPII} from '../../pii';
import type {PagedResult} from '../../pos-fetch-paginate';
import type {DigestDocument} from '../../types';
import {DIGEST_COLUMNS, digestRelationForMode, type ChatReadMode} from './relations';

// The chat's OWN digest reader (F10). src/data.ts is the dashboard's reader (a full-power service-role client) and the chat
// tree must never import it: this takes an INJECTED client instead (the digest client, which the guard limits to the one
// digest relation). It selects only the rendered `digest` plus its window and timestamp. `bundle` (verbatim customer
// quotes) is never named here and the guard refuses it. Names are masked at this seam, like src/data.ts does.
// No server-only, no next/*, no supabase-js import: pure and unit tested.

export interface DigestRow {
  window_from: string;
  window_to: string;
  created_at: string;
  digest: DigestDocument;
}

/** The slice of a select builder this read uses. */
interface DigestReadBuilder extends PromiseLike<PagedResult> {
  order(column: string, options?: {ascending?: boolean}): DigestReadBuilder;
  limit(count: number): DigestReadBuilder;
}
export interface DigestReadClient {
  from(relation: string): {select(columns: string): DigestReadBuilder};
}

/** How many stored weekly digests are read: the latest, the one before it, and the recent weeks of a week-by-week series. */
export const DIGEST_ROW_LIMIT = 12;

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function toRow(raw: unknown): DigestRow | null {
  if (!isRecord(raw) || typeof raw.window_to !== 'string' || !isRecord(raw.digest)) return null;
  return {
    window_from: typeof raw.window_from === 'string' ? raw.window_from : '',
    window_to: raw.window_to,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : '',
    digest: maskDigestPII(raw.digest as unknown as DigestDocument),
  };
}

/** Newest first. A row whose shape is unusable is dropped, not guessed at. Throws when the read fails. */
export async function readDigestRows(client: DigestReadClient, mode: ChatReadMode): Promise<DigestRow[]> {
  const {data, error} = await client
    .from(digestRelationForMode(mode))
    .select(DIGEST_COLUMNS)
    .order('window_to', {ascending: false})
    .limit(DIGEST_ROW_LIMIT);
  if (error) throw new Error(`digest read failed: ${error.message}`);
  return (data ?? []).map(toRow).filter((r): r is DigestRow => r !== null);
}
