import Anthropic from '@anthropic-ai/sdk';
import {getDigests} from '@/src/data';
import {buildCoopSystemPrompt} from '@/src/chat/context';
import {COOP_CHAT} from '@/src/chat/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return new Response('Coop chat is not configured (missing API key).', {status: 503});

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (rateLimited(ip, Date.now())) return new Response('Too many requests — give Coop a moment.', {status: 429});

  let body: {messages?: InMsg[]; week?: string};
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
  const system = buildCoopSystemPrompt(rows, body.week);

  const anthropic = new Anthropic({apiKey: key});
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const run = anthropic.messages.stream({
          model: COOP_CHAT.model,
          max_tokens: COOP_CHAT.maxTokens,
          thinking: {type: 'adaptive'},
          system,
          messages,
        });
        for await (const event of run) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        await run.finalMessage();
      } catch (err) {
        controller.enqueue(encoder.encode(`\n\n⚠️ Coop hit an error: ${(err as Error).message}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'},
  });
}
