'use client';

import {Info} from 'lucide-react';
import {cn} from '@/lib/utils';

/** A small ⓘ trigger that reveals a styled tooltip on hover/focus, explaining
 *  where a figure comes from. Keyboard-accessible; dark bubble on any theme. */
export function InfoTip({text, className}: {text: string; className?: string}) {
  return (
    <span className={cn('group/tip relative inline-flex align-middle', className)}>
      <button
        type="button"
        aria-label={text}
        className="inline-flex items-center rounded-full text-muted-foreground/55 outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Info className="size-[13px]" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-max max-w-[220px] -translate-x-1/2 rounded-lg bg-foreground px-2.5 py-1.5 text-[11px] font-normal normal-case leading-snug tracking-normal text-background opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
