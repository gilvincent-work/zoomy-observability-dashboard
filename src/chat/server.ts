import 'server-only';
import {unstable_cache} from 'next/cache';
import {MOCK_POS_EVENTS, MOCK_POS_ORDERS} from '../pos-sales-mock';
import {logGuardTrip} from './audit';
import {chatReadClient} from './read/client';
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
const loadCached = unstable_cache(
  async (mode: ChatReadMode): Promise<MetricData> => {
    const {client} = chatReadClient({mode, onTrip: (b) => logGuardTrip({layer: 'http_guard', detail: b})});
    return loadMetricData(client, mode);
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
  return loadCached(readable.mode);
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
