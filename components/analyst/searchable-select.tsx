'use client';

// A searchable dropdown (combobox) that replaces the native <select> product / order
// pickers, which got hard to scan once the catalog grew past ~30 items. A trigger
// button shows the current selection (or a placeholder); clicking opens a panel with
// an autofocus search box and a scrollable, filtered option list. Picking an option,
// Escape, or a click outside closes it. The panel is portalled with fixed positioning
// (like the row · menu) so it escapes the modal's overflow container and flips above
// the trigger when there is no room below. Styled to match the incumbent selects.

import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Check, ChevronsUpDown, Search, X} from 'lucide-react';
import {cn} from '@/lib/utils';

export interface SearchableOption {
  value: string;
  label: string;
  hint?: string;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((o) => o.value === value);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-2 text-left text-sm outline-none focus-visible:border-ring',
          !selected && 'text-muted-foreground',
          className,
        )}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <SearchablePanel
          anchor={btnRef.current}
          options={options}
          value={value}
          onPick={(v) => {
            onChange(v);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function SearchablePanel({
  anchor,
  options,
  value,
  onPick,
  onClose,
}: {
  anchor: HTMLElement | null;
  options: SearchableOption[];
  value: string;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{left: number; top: number; width: number} | null>(null);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q))
    : options;

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const m = ref.current.getBoundingClientRect();
    const gap = 6, pad = 8;
    const width = a.width;
    const left = Math.max(pad, Math.min(a.left, window.innerWidth - width - pad));
    let top = a.bottom + gap;
    if (top + m.height > window.innerHeight - pad) {
      const above = a.top - gap - m.height;
      top = above >= pad ? above : Math.max(pad, window.innerHeight - m.height - pad);
    }
    setPos({left, top, width});
  }, [anchor, filtered.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && anchor && !anchor.contains(e.target as Node)) onClose();
    };
    // Capture Escape before the surrounding modal's own listener so it only closes
    // this popover, not the whole dialog.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    // Close on scroll of the page / modal body, but ignore scrolling inside our own
    // option list.
    const onScroll = (e: Event) => {
      if (ref.current && ref.current.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor, onClose]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={ref}
      style={{position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: pos?.width, visibility: pos ? 'visible' : 'hidden'}}
      className="z-[60] overflow-hidden rounded-md border bg-popover text-left shadow-lg"
      role="listbox"
    >
      <div className="flex items-center gap-2 border-b px-2.5 py-2">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(filtered.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const o = filtered[active];
              if (o) onPick(o.value);
            }
          }}
          placeholder="Search…"
          aria-label="Search options"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <ul className="max-h-60 overflow-y-auto py-1">
        {value && !q && (
          <li>
            <button
              type="button"
              onClick={() => onPick('')}
              className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5 shrink-0" /> Clear selection
            </button>
          </li>
        )}
        {filtered.length === 0 ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">No matches.</li>
        ) : (
          filtered.map((o, i) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => onPick(o.value)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors',
                  i === active ? 'bg-muted' : 'hover:bg-muted',
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Check className={cn('size-3.5 shrink-0 text-primary', o.value === value ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{o.label}</span>
                </span>
                {o.hint && <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">{o.hint}</span>}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>,
    document.body,
  );
}
