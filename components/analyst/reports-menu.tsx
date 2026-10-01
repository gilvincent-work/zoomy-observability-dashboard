'use client';

// A small dropdown for the Reports UI (version list, "more" menu). The shadcn set here has no dropdown, so this is the
// minimum: a trigger, a panel that closes on outside tap, Escape or choosing an item, and 40px tap targets. The panel is
// capped to the viewport width so it stays usable at 360px.
import {useEffect, useRef, useState} from 'react';
import {cn} from '@/lib/utils';

export const MENU_ITEM =
  'flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-50';

export function Menu({
  trigger,
  label,
  align = 'left',
  panelClassName,
  triggerClassName,
  children,
}: {
  /** The trigger's visible content. */
  trigger: React.ReactNode;
  /** Accessible name for the trigger when its content is only an icon. */
  label?: string;
  align?: 'left' | 'right';
  panelClassName?: string;
  triggerClassName?: string;
  /** Receives `close`, so an item can dismiss the panel. */
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-muted',
          triggerClassName,
        )}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute top-full z-30 mt-1.5 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none',
            align === 'right' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
