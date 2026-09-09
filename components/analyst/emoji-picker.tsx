'use client';

import {useState} from 'react';
import {Popover} from '@base-ui/react/popover';
import {Delete} from 'lucide-react';
import {cn} from '@/lib/utils';
import {DEFAULT_EMOJI, MAX_EMOJI, PRODUCT_EMOJIS, clampEmoji, graphemes} from '@/src/pos-format';

/**
 * Tap-only emoji picker (up to MAX_EMOJI). No text input — users select from a
 * curated grid, since there's no reliable way to type emoji on a desktop. The
 * trigger shows the current value; a grid taps to add and a backspace removes
 * the last one. `onCommit` fires when the popup closes with a changed value, so
 * inline callers don't write on every tap.
 */
export function EmojiPicker({
  value,
  onChange,
  onCommit,
  className,
  ariaLabel = 'Choose emoji',
}: {
  value: string;
  onChange?: (next: string) => void;
  onCommit?: (next: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const chosen = graphemes(draft);
  const full = chosen.length >= MAX_EMOJI;

  function set(next: string) {
    setDraft(next);
    onChange?.(next);
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value);
        else if (draft !== value) onCommit?.(draft);
        setOpen(next);
      }}
    >
      <Popover.Trigger
        className={cn(
          'inline-flex h-8 min-w-14 items-center justify-center gap-1 rounded-md border bg-background px-2 text-lg leading-none outline-none transition-colors hover:border-primary focus-visible:border-ring',
          className,
        )}
        aria-label={ariaLabel}
      >
        {value || DEFAULT_EMOJI}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6}>
          <Popover.Popup className="z-50 w-64 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md outline-none">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {chosen.length}/{MAX_EMOJI}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-lg leading-none">{draft || DEFAULT_EMOJI}</span>
                <button
                  type="button"
                  onClick={() => set(chosen.slice(0, -1).join(''))}
                  disabled={chosen.length === 0}
                  aria-label="Remove last emoji"
                  className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                >
                  <Delete className="size-4" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-6 gap-1">
              {PRODUCT_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => !full && set(clampEmoji(draft + e))}
                  disabled={full}
                  aria-label={`Add ${e}`}
                  className="grid size-8 place-items-center rounded-md text-lg leading-none transition-colors hover:bg-muted disabled:opacity-40"
                >
                  {e}
                </button>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
