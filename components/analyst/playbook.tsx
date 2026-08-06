'use client';

import {createContext, useCallback, useContext, useEffect, useState} from 'react';
import {Check, ListChecks, X} from 'lucide-react';
import type {DigestRec} from '../../src/types';
import {cn} from '@/lib/utils';

export function recAction(r: DigestRec): string {
  return typeof r === 'string' ? r : r.action;
}
export function recSteps(r: DigestRec): string[] {
  return typeof r === 'string' ? [] : r.steps ?? [];
}

type ActiveRec = {action: string; steps: string[]};
const PlaybookCtx = createContext<{open: (r: ActiveRec) => void}>({open: () => {}});
export const usePlaybook = () => useContext(PlaybookCtx);

/** Provides the "open a playbook" action and renders the slide-over drawer once. */
export function PlaybookProvider({children}: {children: React.ReactNode}) {
  const [active, setActive] = useState<ActiveRec | null>(null);
  const open = useCallback((r: ActiveRec) => setActive(r), []);
  return (
    <PlaybookCtx.Provider value={{open}}>
      {children}
      <PlaybookDrawer rec={active} onClose={() => setActive(null)} />
    </PlaybookCtx.Provider>
  );
}

// localStorage key for a checklist's progress — keyed by the action text so ticks
// persist across visits (truncated to keep the key bounded).
const keyFor = (action: string) => `coop-pb:${action.slice(0, 140)}`;

// Fired whenever a checklist changes, so action cards re-read their progress live.
const PROGRESS_EVENT = 'coop-pb-progress';

function readDoneCount(action: string): number {
  try {
    const raw = localStorage.getItem(keyFor(action));
    if (!raw) return 0;
    const arr = JSON.parse(raw) as boolean[];
    return Array.isArray(arr) ? arr.filter(Boolean).length : 0;
  } catch {
    return 0;
  }
}

/** Live completion for one action's playbook (updates when the drawer toggles). */
export function usePlaybookProgress(action: string, total: number): {done: number; complete: boolean} {
  const [done, setDone] = useState(0);
  useEffect(() => {
    const update = () => setDone(readDoneCount(action));
    update();
    window.addEventListener(PROGRESS_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(PROGRESS_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, [action, total]);
  return {done, complete: total > 0 && done >= total};
}

function PlaybookDrawer({rec, onClose}: {rec: ActiveRec | null; onClose: () => void}) {
  const [done, setDone] = useState<boolean[]>([]);

  useEffect(() => {
    if (!rec) return;
    try {
      const raw = localStorage.getItem(keyFor(rec.action));
      const saved = raw ? (JSON.parse(raw) as boolean[]) : null;
      setDone(saved && saved.length === rec.steps.length ? saved : rec.steps.map(() => false));
    } catch {
      setDone(rec.steps.map(() => false));
    }
  }, [rec]);

  useEffect(() => {
    if (!rec) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rec, onClose]);

  if (!rec) return null;

  const toggle = (i: number) =>
    setDone((prev) => {
      const next = prev.map((v, j) => (j === i ? !v : v));
      try {
        localStorage.setItem(keyFor(rec.action), JSON.stringify(next));
        window.dispatchEvent(new CustomEvent(PROGRESS_EVENT));
      } catch {
        /* private mode — progress just isn't persisted */
      }
      return next;
    });

  const completed = done.filter(Boolean).length;
  const total = rec.steps.length;

  return (
    <div className="fixed inset-0 z-[80]">
      <button
        aria-label="Close playbook"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/20 animate-in fade-in"
      />
      <aside
        role="dialog"
        aria-label="Action playbook"
        className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-2xl animate-in slide-in-from-right duration-300"
      >
        <header className="flex items-start gap-3 border-b border-border p-5">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-primary" style={{backgroundColor: 'color-mix(in oklab, var(--primary) 12%, transparent)'}}>
            <ListChecks className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Playbook</div>
            <p className="mt-1 text-[15px] font-medium leading-snug text-foreground">{rec.action}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{width: `${total ? (completed / total) * 100 : 0}%`}} />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {completed} / {total} done
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <ol className="space-y-2">
            {rec.steps.map((s, i) => (
              <li key={i}>
                <button
                  onClick={() => toggle(i)}
                  className="flex w-full items-start gap-3 rounded-xl border border-border p-3.5 text-left transition-colors hover:bg-muted/40"
                >
                  <span
                    className={cn(
                      'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                      done[i] ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                    )}
                  >
                    {done[i] && <Check className="size-3.5" />}
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                    <span className={cn('text-[14.5px] leading-relaxed', done[i] ? 'text-muted-foreground line-through' : 'text-foreground/90')}>
                      {s}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}
