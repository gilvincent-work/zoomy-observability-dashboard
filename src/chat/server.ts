import 'server-only';
import {unstable_cache} from 'next/cache';
import {MOCK_DIGESTS} from '../mock';
import {maskRows} from '../pii';
import {MOCK_POS_EVENTS, MOCK_POS_ORDERS} from '../pos-sales-mock';
import {logGuardTrip} from './audit';
import type {DigestSource} from './digest-lookup';
import {chatDigestClient, chatReadClient} from './read/client';
import {readDigestRows, DIGEST_ROW_LIMIT, type DigestRow} from './read/digest';
import {loadMetricData} from './read/metric-data';
import {assertChatReadable} from './read/mode';
import type {ChatReadMode} from './read/relations';
import type {MetricData} from './result-types';

// Glue for the chat route: the cached MetricData loader and the unavailable-error. One place that touches env.

export class ChatUnavailableError extends Error {
  readonly status = 503;
}

let warned = false;

function mockData(): MetricData {
  return {
    source: 'mock',
    orders: MOCK_POS_ORDERS,
    events: MOCK_POS_EVENTS,
    prices: [],
    priceChanges: [],
    bulkReads: [
      {relation: 'mock_orders', rows: MOCK_POS_ORDERS.length},
      {relation: 'mock_events', rows: MOCK_POS_EVENTS.length},
    ],
  };
}

// The client lives inside the cached function (it cannot be cached), and its guard stats are dropped. Trips are
// logged through onTrip. A burst of questions inside 60 seconds reads the database once.
// The cache key is the function's arguments: `project` (the archive host, never a secret) keeps two Supabase projects from ever
// sharing an entry, and the miss log shows how close the data is to the 2 MiB data-cache item limit.
const projectOf = (): string => {
  try {
    return new URL(process.env.SUPABASE_URL_ARCHIVE ?? '').host;
  } catch {
    return 'none';
  }
};
const loadCached = unstable_cache(
  async (mode: ChatReadMode, _project: string): Promise<MetricData> => {
    const {client} = chatReadClient({mode, onTrip: (b) => logGuardTrip({layer: 'http_guard', detail: b})});
    const data = await loadMetricData(client, mode);
    console.info(JSON.stringify({event: 'chat_data_loaded', orders: data.orders.length, bytes: JSON.stringify(data).length}));
    return data;
  },
  ['chat-metric-data'],
  {revalidate: 60, tags: ['chat-metric-data']},
);

export async function getChatMetricData(): Promise<MetricData> {
  if (!process.env.SUPABASE_URL_ARCHIVE) return mockData();
  const readable = assertChatReadable(process.env);
  if (!readable.ok) throw new ChatUnavailableError(readable.message);
  if (readable.warning && !warned) {
    warned = true;
    console.warn(readable.warning);
  }
  return loadCached(readable.mode, projectOf());
}

export type ChatDataResult = {ok: true; data: MetricData} | {ok: false; reason: string};

const degradedSeen = new Set<string>();

/**
 * The data for this request, or a reason the live-data path is unavailable (production before the read-only role is
 * applied, a missing secret, a failed load). The caller then runs digest-only: no tools, no POS reads. Fail closed on
 * data, never on the whole chat. Each distinct reason is logged once per process.
 */
export async function getChatMetricDataOrDegrade(): Promise<ChatDataResult> {
  try {
    return {ok: true, data: await getChatMetricData()};
  } catch (err) {
    const reason = err instanceof ChatUnavailableError ? err.message : `data load failed (${(err as Error)?.name ?? 'Error'})`;
    if (!degradedSeen.has(reason)) {
      degradedSeen.add(reason);
      console.warn(JSON.stringify({event: 'chat_degraded', reason}));
    }
    return {ok: false, reason};
  }
}

// F10: the stored weekly digests for get_digest. Its own guarded client (one relation, `bundle` refused), cached for five
// minutes like the dashboard's digest read, under the same tag so revalidateTag('digest-archive') refreshes both.
const loadDigestCached = unstable_cache(
  async (mode: ChatReadMode, _project: string): Promise<DigestRow[]> => {
    const {client} = chatDigestClient({mode, onTrip: (b) => logGuardTrip({layer: 'http_guard', detail: b})});
    return readDigestRows(client, mode);
  },
  ['chat-digest'],
  {revalidate: 300, tags: ['digest-archive']},
);

export async function getChatDigest(): Promise<DigestSource> {
  if (!process.env.SUPABASE_URL_ARCHIVE) {
    const rows = maskRows([...MOCK_DIGESTS].sort((a, b) => b.window_to.localeCompare(a.window_to)).slice(0, DIGEST_ROW_LIMIT));
    return {source: 'mock', rows};
  }
  const readable = assertChatReadable(process.env);
  if (!readable.ok) throw new ChatUnavailableError(readable.message);
  return {source: 'live', rows: await loadDigestCached(readable.mode, projectOf())};
}
