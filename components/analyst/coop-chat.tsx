'use client';

import {createContext, useCallback, useContext, useEffect, useRef, useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {Sparkles, X, ArrowUp} from 'lucide-react';
import {cn} from '@/lib/utils';

type Msg = {role: 'user' | 'assistant'; content: string};

const CoopChatCtx = createContext<{ask: (q: string) => void; open: () => void}>({ask: () => {}, open: () => {}});
export const useCoopChat = () => useContext(CoopChatCtx);

const SUGGESTIONS = [
  'Which channel has the best ROAS?',
  'What should I prioritize this week?',
  'Compare Shopee and Lazada ad spend.',
  'Which products are driving revenue?',
];

export function CoopChatProvider({children}: {children: React.ReactNode}) {
  const [isOpen, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const week = useSearchParams().get('week') ?? undefined;

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

  return (
    <CoopChatCtx.Provider value={{ask, open: () => setOpen(true)}}>
      {children}
      {isOpen && <CoopChatDrawer messages={messages} busy={busy} onClose={() => setOpen(false)} onAsk={ask} />}
    </CoopChatCtx.Provider>
  );
}

function CoopChatDrawer({messages, busy, onClose, onAsk}: {messages: Msg[]; busy: boolean; onClose: () => void; onAsk: (q: string) => void}) {
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
            <div className="text-[11px] text-muted-foreground">Answers grounded in your store data</div>
          </div>
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
          {messages.map((m, i) => (
            <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed',
                  m.role === 'user' ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-foreground',
                )}
              >
                {m.content || (busy && i === messages.length - 1 ? <span className="text-muted-foreground">Coop is thinking…</span> : null)}
              </div>
            </div>
          ))}
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
