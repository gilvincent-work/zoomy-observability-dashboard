import Anthropic from '@anthropic-ai/sdk';
import {getDigests} from '@/src/data';
import {buildDigestBlock, buildStaticSystem} from '@/src/chat/context';
import {CHAT_EFFORT, COOP_CHAT} from '@/src/chat/config';
import {runChatLoop, SAFE_ERROR_TEXT} from '@/src/chat/loop';
import {encodeEvent} from '@/src/chat/stream-protocol';
import {buildDegradedPreamble, buildPreamble} from '@/src/chat/preamble';
import {CHAT_TOOLS} from '@/src/chat/tool-defs';
import {createExecutors} from '@/src/chat/tool-executors';
import {getChatMetricDataOrDegrade} from '@/src/chat/server';
import type {ChatStreamEvent} from '@/src/chat/stream-types';
import {auth} from '@/auth';
import {devAuthEnabled, DEV_SESSION} from '@/src/dev-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Minimal in-memory sliding-window rate limit (per IP). Cold-start reset is fine.
const HITS = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
function rateLimited(ip: string, now: number): boolean {
  const fresh = (HITS.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  fresh.push(now);
  HITS.set(ip, fresh);
  return fresh.length > MAX_PER_WINDOW;
}

type InMsg = {role: 'user' | 'assistant'; content: string};

export async function POST(req: Request) {
  const session = devAuthEnabled() ? DEV_SESSION : await auth();
  if (!session?.user) return new Response('Please sign in to use Coop.', {status: 401});

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return new Response('Coop chat is not configured (missing API key).', {status: 503});

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (rateLimited(ip, Date.now())) return new Response('Too many requests — give Coop a moment.', {status: 429});

  let body: {messages?: InMsg[]; week?: string; home?: boolean};
  try {
    body = await req.json();
  } catch {
    return new Response('Bad request.', {status: 400});
  }

  // Sanitize + cap the conversation the client sends back.
  const messages = (body.messages || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map((m) => ({role: m.role, content: m.content.slice(0, 2000)}));
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return new Response('No question provided.', {status: 400});
  }

  const rows = await getDigests(); // PII-masked server-side

  // Live POS data is fail-closed: where the read path is not ready (production before the read-only database role is
  // applied, a missing secret, a failed load) the chat degrades to digest-only (no tools, no POS reads) instead of
  // going down. The reason is logged once as chat_degraded.
  const live = await getChatMetricDataOrDegrade();
  const system = [
    {type: 'text' as const, text: buildStaticSystem({tools: live.ok}), cache_control: {type: 'ephemeral' as const}},
    {type: 'text' as const, text: buildDigestBlock(rows, body.week, {home: body.home === true}), cache_control: {type: 'ephemeral' as const}},
  ];

  const now = new Date();
  const user = session.user.email ?? null;
  const anthropic = new Anthropic({apiKey: key});
  return ndjson((emit) =>
    runChatLoop({
      client: anthropic,
      model: COOP_CHAT.model,
      maxTokens: COOP_CHAT.maxTokens,
      effort: CHAT_EFFORT,
      system,
      tools: live.ok ? CHAT_TOOLS : [],
      messages,
      preamble: live.ok ? buildPreamble(live.data, now) : buildDegradedPreamble(now),
      executors: live.ok ? createExecutors({data: async () => live.data, now, user, emitBlock: (block) => emit({t: 'block', block})}) : {},
      emit,
      user,
      signal: req.signal,
    }).then(() => undefined),
  );
}

/** One NDJSON response: run `work` with an emitter, always close the stream. */
function ndjson(work: (emit: (e: ChatStreamEvent) => void) => void | Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (e: ChatStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(e)));
        } catch {
          closed = true; // the client went away
        }
      };
      try {
        await work(emit);
      } catch {
        emit({t: 'error', message: SAFE_ERROR_TEXT});
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: {'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store'},
  });
}
