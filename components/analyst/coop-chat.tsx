'use client';

import {createContext, useCallback, useContext, useEffect, useRef, useState} from 'react';
import {useSearchParams} from 'next/navigation';
import Markdown from 'react-markdown';
import {Sparkles, X, ArrowUp, Plus, Copy, Check} from 'lucide-react';
import {cn} from '@/lib/utils';

type Msg = {role: 'user' | 'assistant'; content: string};

const CoopChatCtx = createContext<{ask: (q: string) => void; open: () => void; scopeLabel?: string}>({
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

/** Split a raw assistant message into visible text + follow-up suggestions,
 *  tolerating a partially-streamed <suggest> tag. */
function parseAssistant(raw: string): {text: string; suggestions: string[]} {
  const m = raw.match(/<suggest>([\s\S]*?)<\/suggest>/);
  const suggestions = m ? m[1].split('|').map((s) => s.trim()).filter(Boolean).slice(0, 3) : [];
  const text = raw
    .replace(/<suggest>[\s\S]*?<\/suggest>/g, '')
    .replace(/<suggest[\s\S]*$/, '') // dangling partial while streaming
    .trim();
  return {text, suggestions};
}

export function CoopChatProvider({children, scopeLabel}: {children: React.ReactNode; scopeLabel?: string}) {
  const [isOpen, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const week = useSearchParams().get('week') ?? undefined;

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
      setBusy(true);
      setMessages([...history, {role: 'assistant', content: ''}]);
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({messages: history, week}),
        });
        if (!res.ok || !res.body) {
          const text = (await res.text().catch(() => '')) || 'Coop is unavailable right now.';
          setMessages([...history, {role: 'assistant', content: text}]);
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
        setMessages([...history, {role: 'assistant', content: `⚠️ ${(e as Error).message}`}]);
      } finally {
        setBusy(false);
      }
    },
    [week],
  );

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

  const open = useCallback(() => setOpen(true), []);

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
      {isOpen && (
        <CoopChatDrawer messages={messages} busy={busy} scopeLabel={scopeLabel} onClose={() => setOpen(false)} onAsk={ask} onNewChat={newChat} />
      )}
    </CoopChatCtx.Provider>
  );
}

/** The compact top-bar entry point. */
export function AskCoopPill() {
  const {open} = useCoopChat();
  return (
    <button
      type="button"
      onClick={open}
      className="coop-pill-glow inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3.5 py-1.5 text-sm font-medium text-foreground transition-all hover:-translate-y-0.5 hover:bg-primary/15 hover:shadow-md"
    >
      <Sparkles className="size-4 animate-pulse text-primary" />
      <span className="hidden sm:inline">
        Ask{' '}
        <span className="font-extrabold tracking-tight">
          co<span style={{color: 'var(--primary)'}}>o</span>p
        </span>
      </span>
      <kbd className="ml-1 hidden rounded border border-primary/30 bg-background/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground md:inline">⌘K</kbd>
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
  scopeLabel,
  onClose,
  onAsk,
  onNewChat,
}: {
  messages: Msg[];
  busy: boolean;
  scopeLabel?: string;
  onClose: () => void;
  onAsk: (q: string) => void;
  onNewChat: () => void;
}) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="fixed inset-0 z-[80]">
      <button aria-label="Close chat" onClick={onClose} className="absolute inset-0 bg-foreground/20 animate-in fade-in" />
      <aside
        role="dialog"
        aria-label="Chat with Coop"
        className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-2xl animate-in slide-in-from-right duration-300"
      >
        <header className="flex items-center gap-2.5 border-b border-border p-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-foreground">Chat with Coop</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {scopeLabel ? `Answering about ${scopeLabel}` : 'Answers grounded in your store data'}
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

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="space-y-3 pt-2">
              <p className="text-[13px] text-muted-foreground">Ask Coop about your sales, ads, products, or what to do next. Try:</p>
              <div className="flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => onAsk(s)} className="rounded-xl border border-border bg-card px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:border-primary/50 hover:bg-muted">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => {
            if (m.role === 'user') {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-primary px-3.5 py-2 text-[13.5px] leading-relaxed text-primary-foreground">{m.content}</div>
                </div>
              );
            }
            const {text, suggestions} = parseAssistant(m.content);
            const streamingThis = busy && i === lastIdx;
            return (
              <div key={i} className="flex flex-col items-start">
                <div className="max-w-[90%] rounded-2xl border border-border bg-card px-3.5 py-2 text-[13.5px] leading-relaxed text-foreground [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1 [&_strong]:font-semibold [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4">
                  {text ? <Markdown>{text}</Markdown> : streamingThis ? <span className="text-muted-foreground">Coop is thinking…</span> : null}
                </div>
                {!streamingThis && text && <CopyButton text={text} />}
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

        <form onSubmit={submit} className="flex items-center gap-2 border-t border-border p-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask a follow-up…"
            aria-label="Message Coop"
            className="min-w-0 flex-1 rounded-full border border-border bg-card px-4 py-2 text-[14px] text-foreground outline-none transition-colors focus:border-primary/50"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label="Send"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        </form>
      </aside>
    </div>
  );
}
