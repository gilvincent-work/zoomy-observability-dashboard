'use client';

import {createContext, useCallback, useContext, useEffect, useRef, useState} from 'react';
import {useSearchParams, usePathname, useRouter} from 'next/navigation';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {Sparkles, X, ArrowUp, Plus, Copy, Check, Square, RotateCcw, ArrowRight, AlertCircle} from 'lucide-react';
import {cn} from '@/lib/utils';

type Msg = {role: 'user' | 'assistant'; content: string; error?: boolean};
type NavAction = {label: string; path: string};

type Side = 'left' | 'right';
const CoopChatCtx = createContext<{ask: (q: string) => void; open: (side?: Side) => void; scopeLabel?: string}>({
  ask: () => {},
  open: () => {},
});
export const useCoopChat = () => useContext(CoopChatCtx);

const STORE_KEY = 'coop-chat-v1';
const SUGGESTIONS = [
  'Which channel has the best ROAS?',
  'What should I prioritize this week?',
  'Compare Shopee and Lazada ad spend.',
  'Which products are driving revenue?',
];
// Home screen: no period loaded yet, so orient the user instead.
const HOME_SUGGESTIONS = [
  'What can you help me with?',
  'How do I compare my channels?',
  'Where do I see ad spend and ROAS?',
  'What should I look at first?',
];

const APP_PATHS = new Set(['/', '/?channel=all', '/?channel=shopee', '/?channel=lazada', '/?channel=website', '/customers', '/inventory', '/traffic']);

/** Split a raw assistant message into visible text + follow-up suggestions + nav
 *  actions, tolerating partially-streamed hidden tags. */
function parseAssistant(raw: string): {text: string; suggestions: string[]; actions: NavAction[]} {
  const sm = raw.match(/<suggest>([\s\S]*?)<\/suggest>/);
  const suggestions = sm ? sm[1].split('|').map((s) => s.trim()).filter(Boolean).slice(0, 3) : [];

  const gm = raw.match(/<go>([\s\S]*?)<\/go>/);
  const actions: NavAction[] = gm
    ? gm[1]
        .split('||')
        .map((entry) => {
          const i = entry.indexOf('|');
          if (i < 0) return null;
          const label = entry.slice(0, i).trim();
          const path = entry.slice(i + 1).trim();
          return label && APP_PATHS.has(path) ? {label, path} : null;
        })
        .filter((a): a is NavAction => a !== null)
        .slice(0, 3)
    : [];

  const text = raw
    .replace(/<suggest>[\s\S]*?<\/suggest>/g, '')
    .replace(/<go>[\s\S]*?<\/go>/g, '')
    .replace(/<(?:suggest|go)[\s\S]*$/, '') // dangling partial while streaming
    .trim();
  return {text, suggestions, actions};
}

export function CoopChatProvider({children, scopeLabel}: {children: React.ReactNode; scopeLabel?: string}) {
  const [isOpen, setOpen] = useState(false);
  const [side, setSide] = useState<Side>('right');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const week = searchParams.get('week') ?? undefined;
  // Home = the landing brief (no channel opened) → generic getting-started mode.
  const home = pathname === '/' && !searchParams.get('channel');

  // Persist the conversation across reloads.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(messages));
    } catch {
      /* ignore */
    }
  }, [messages]);

  const send = useCallback(
    async (history: Msg[]) => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setBusy(true);
      setMessages([...history, {role: 'assistant', content: ''}]);
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({messages: history, week, home}),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          // Friendly copy per status; the raw body is the server's message.
          const raw = (await res.text().catch(() => '')) || '';
          const msg =
            res.status === 401
              ? 'Your session expired. Please refresh the page and sign in again.'
              : res.status === 429
                ? 'Coop is getting a lot of questions right now — give it a few seconds and try again.'
                : res.status === 503
                  ? 'Coop isn’t configured yet (missing API key). Ping your admin.'
                  : raw || 'Coop is unavailable right now. Please try again.';
          setMessages([...history, {role: 'assistant', content: msg, error: true}]);
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let acc = '';
        for (;;) {
          const {done, value} = await reader.read();
          if (done) break;
          acc += dec.decode(value, {stream: true});
          setMessages([...history, {role: 'assistant', content: acc}]);
        }
      } catch (e) {
        // A user-initiated stop keeps the partial answer; other errors show a bubble.
        if ((e as Error).name === 'AbortError') return;
        setMessages([...history, {role: 'assistant', content: `Something went wrong: ${(e as Error).message}`, error: true}]);
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [week, home],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const regenerate = useCallback(() => {
    if (busy) return;
    setMessages((prev) => {
      // Drop the trailing assistant reply and re-send from the last user turn.
      let end = prev.length;
      while (end > 0 && prev[end - 1].role === 'assistant') end--;
      const history = prev.slice(0, end);
      if (!history.length || history[history.length - 1].role !== 'user') return prev;
      void send(history);
      return history;
    });
  }, [busy, send]);

  const ask = useCallback(
    (q: string) => {
      const question = q.trim();
      if (!question || busy) return;
      setOpen(true);
      setMessages((prev) => {
        const next: Msg[] = [...prev, {role: 'user', content: question}];
        void send(next);
        return next;
      });
    },
    [busy, send],
  );

  const open = useCallback((s: Side = 'right') => {
    setSide(s);
    setOpen(true);
  }, []);

  // ⌘K / Ctrl+K opens Coop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const newChat = useCallback(() => {
    setMessages([]);
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <CoopChatCtx.Provider value={{ask, open, scopeLabel}}>
      {children}
      {!isOpen && <CoopFab onOpen={() => open('left')} />}
      {isOpen && (
        <CoopChatDrawer
          messages={messages}
          busy={busy}
          side={side}
          scopeLabel={scopeLabel}
          home={home}
          onClose={() => setOpen(false)}
          onAsk={ask}
          onNewChat={newChat}
          onStop={stop}
          onRegenerate={regenerate}
        />
      )}
    </CoopChatCtx.Provider>
  );
}

/** Always-visible floating "Ask coop" button, pinned bottom-left in the nav rail.
 *  Opens the chat on the LEFT so it doesn't cover right-side dashboard content. */
function CoopFab({onOpen}: {onOpen: () => void}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Ask coop"
      title="Ask coop"
      className="fixed bottom-4 left-3 z-[70] flex size-10 items-center justify-center overflow-hidden rounded-full border border-primary/50 bg-primary/10 text-primary shadow-sm transition-all hover:-translate-y-0.5 hover:bg-primary/15 hover:shadow-md"
    >
      <span className="coop-shine" aria-hidden />
      <Sparkles className="size-4" />
    </button>
  );
}

/** The coop wordmark (lowercase, green second "o") — matches the top-left logo. */
function CoopWord() {
  return (
    <span className="font-extrabold tracking-tight">
      co<span style={{color: 'var(--primary)'}}>o</span>p
    </span>
  );
}

/** The compact top-bar entry point — a shine sweep glides across to draw the eye. */
export function AskCoopPill() {
  const {open} = useCoopChat();
  return (
    <button
      type="button"
      onClick={() => open('right')}
      className="relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-primary/50 bg-primary/10 px-3.5 py-1.5 text-sm font-medium text-foreground transition-all hover:-translate-y-0.5 hover:bg-primary/15 hover:shadow-md"
    >
      <span className="coop-shine" aria-hidden />
      <Sparkles className="size-4 text-primary" />
      <span>
        Ask <CoopWord />
      </span>
    </button>
  );
}

function CopyButton({text}: {text: string}) {
  const [done, setDone] = useState(false);
  if (!text) return null;
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      aria-label="Copy"
      className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
    >
      {done ? <Check className="size-3" /> : <Copy className="size-3" />} {done ? 'Copied' : 'Copy'}
    </button>
  );
}

function CoopChatDrawer({
  messages,
  busy,
  side,
  scopeLabel,
  home,
  onClose,
  onAsk,
  onNewChat,
  onStop,
  onRegenerate,
}: {
  messages: Msg[];
  busy: boolean;
  side: Side;
  scopeLabel?: string;
  home?: boolean;
  onClose: () => void;
  onAsk: (q: string) => void;
  onNewChat: () => void;
  onStop: () => void;
  onRegenerate: () => void;
}) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    scrollRef.current?.scrollTo({top: scrollRef.current.scrollHeight, behavior: 'smooth'});
  }, [messages]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || busy) return;
    onAsk(draft);
    setDraft('');
  };

  const lastIdx = messages.length - 1;
  const empty = messages.length === 0;

  const composer = (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={empty ? 'Ask coop anything…' : 'Ask a follow-up…'}
        aria-label="Message Coop"
        autoFocus
        className="min-w-0 flex-1 rounded-full border border-border bg-card px-4 py-2.5 text-[14px] text-foreground outline-none transition-colors focus:border-primary/50"
      />
      {busy ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop"
          title="Stop"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Square className="size-3.5 fill-current" />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label="Send"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          <ArrowUp className="size-4" />
        </button>
      )}
    </form>
  );

  return (
    <div className="fixed inset-0 z-[80]">
      <button aria-label="Close chat" onClick={onClose} className="absolute inset-0 bg-foreground/20 animate-in fade-in" />
      <aside
        role="dialog"
        aria-label="Chat with Coop"
        className={cn(
          'absolute top-0 flex h-full w-full max-w-md flex-col bg-background shadow-2xl animate-in duration-300',
          side === 'left' ? 'left-0 border-r border-border slide-in-from-left' : 'right-0 border-l border-border slide-in-from-right',
        )}
      >
        <header className="flex items-center gap-2.5 border-b border-border p-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-foreground">
              Chat with <CoopWord />
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {home ? 'Getting started — ask what you can do here' : scopeLabel ? `Answering about ${scopeLabel}` : 'Answers grounded in your store data'}
            </div>
          </div>
          {messages.length > 0 && (
            <button onClick={onNewChat} aria-label="New chat" title="New chat" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Plus className="size-4" />
            </button>
          )}
          <button onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        </header>

        {empty ? (
          // Session start: greeting + suggestions + composer, vertically centered.
          <div className="flex flex-1 flex-col justify-center gap-5 overflow-y-auto p-5">
            <p className="text-center text-[13px] text-muted-foreground">
              {home ? 'New here? Ask coop what you can do, or where to start.' : 'Ask coop about your sales, ads, products, or what to do next.'}
            </p>
            {composer}
            <div className="flex flex-col gap-2">
              {(home ? HOME_SUGGESTIONS : SUGGESTIONS).map((s) => (
                <button key={s} onClick={() => onAsk(s)} className="rounded-xl border border-border bg-card px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:border-primary/50 hover:bg-muted">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
              {messages.map((m, i) => {
                if (m.role === 'user') {
                  return (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-primary px-3.5 py-2 text-[13.5px] leading-relaxed text-primary-foreground">{m.content}</div>
                    </div>
                  );
                }
                const {text, suggestions, actions} = parseAssistant(m.content);
                const streamingThis = busy && i === lastIdx;
                if (m.error) {
                  return (
                    <div key={i} className="flex items-start gap-2 rounded-2xl border border-[color-mix(in_oklab,var(--status-crit)_35%,transparent)] bg-[color-mix(in_oklab,var(--status-crit)_8%,transparent)] px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" style={{color: 'var(--status-crit)'}} />
                      <span>{m.content}</span>
                    </div>
                  );
                }
                const isLastAssistant = i === lastIdx;
                return (
                  <div key={i} className="flex flex-col items-start">
                    <div className="max-w-[90%] overflow-hidden rounded-2xl border border-border bg-card px-3.5 py-2 text-[13.5px] leading-relaxed text-foreground [&_a]:text-primary [&_a]:underline [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1 [&_strong]:font-semibold [&_table]:my-1.5 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4">
                      {text ? <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown> : streamingThis ? <span className="text-muted-foreground">Coop is thinking…</span> : null}
                    </div>

                    {!streamingThis && actions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {actions.map((a) => (
                          <button
                            key={a.path + a.label}
                            onClick={() => router.push(a.path)}
                            className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                          >
                            {a.label} <ArrowRight className="size-3" />
                          </button>
                        ))}
                      </div>
                    )}

                    {!streamingThis && text && (
                      <div className="mt-1 flex items-center gap-3">
                        <CopyButton text={text} />
                        {isLastAssistant && (
                          <button onClick={onRegenerate} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground">
                            <RotateCcw className="size-3" /> Regenerate
                          </button>
                        )}
                      </div>
                    )}

                    {!streamingThis && suggestions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {suggestions.map((s) => (
                          <button key={s} onClick={() => onAsk(s)} className="rounded-full border border-primary/30 bg-primary/[0.06] px-2.5 py-1 text-[12px] text-primary transition-colors hover:bg-primary/10">
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="border-t border-border p-3">{composer}</div>
          </>
        )}
      </aside>
    </div>
  );
}
