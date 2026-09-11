'use client';

import {useEffect, useState, useTransition} from 'react';
import {Check, Pencil, Target, X} from 'lucide-react';
import type {DailyProgress, TargetTier} from '@/src/pos-target-types';
import {formatPeso, parsePrice} from '@/src/pos-format';
import {setDailyTargetAction} from '@/src/pos-target-actions';
import {Card, CardContent} from '@/components/ui/card';
import {cn} from '@/lib/utils';

// The gamified daily-target health bar (Phase 5 Surface E). `full` renders a
// card with an inline target editor for /offline-sales; `compact` is a slim,
// read-only strip for the home landing. Fill color escalates red -> amber ->
// lime -> emerald as today's revenue closes on the goal. The fill grows from 0
// on mount (a satisfying one-time reveal), honoring reduced-motion.

type Variant = 'full' | 'compact';

const TIER_UI: Record<TargetTier, {fill: string; label: string; text: string}> = {
  low: {fill: 'bg-red-500', label: 'Getting started', text: 'text-red-600 dark:text-red-400'},
  mid: {fill: 'bg-amber-500', label: 'Building up', text: 'text-amber-600 dark:text-amber-400'},
  high: {fill: 'bg-lime-500', label: 'Almost there', text: 'text-lime-600 dark:text-lime-400'},
  goal: {fill: 'bg-emerald-500', label: 'Goal reached', text: 'text-emerald-600 dark:text-emerald-400'},
};

/** Fill bar shared by both variants. Grows from 0 -> pct once, after mount. */
function ProgressTrack({progress, thick}: {progress: DailyProgress; thick?: boolean}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const width = mounted ? progress.pct : 0;

  return (
    <div
      className={cn('w-full overflow-hidden rounded-full bg-muted', thick ? 'h-3' : 'h-2')}
      role="progressbar"
      aria-valuenow={Math.round(progress.rawPct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Progress toward today's revenue target"
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
          TIER_UI[progress.tier].fill,
        )}
        style={{width: `${width}%`}}
      />
    </div>
  );
}

/** Inline "set the goal" editor, shown only on the full variant. */
function TargetEditor({current, onDone}: {current: number; onDone: () => void}) {
  const [value, setValue] = useState(current > 0 ? String(current) : '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const parsed = parsePrice(value);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    startTransition(async () => {
      const res = await setDailyTargetAction(parsed.value);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-muted-foreground">₱</span>
        <input
          type="number"
          inputMode="decimal"
          min={1}
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onDone();
          }}
          className="w-28 rounded-md border bg-background px-2 py-1 text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring"
          placeholder="Daily goal"
          aria-label="Daily revenue target"
        />
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="inline-flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground transition-transform duration-150 ease-out active:scale-95 disabled:opacity-50"
        aria-label="Save target"
      >
        <Check className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onDone}
        disabled={pending}
        className="inline-flex size-7 items-center justify-center rounded-md border text-muted-foreground transition-transform duration-150 ease-out hover:text-foreground active:scale-95"
        aria-label="Cancel"
      >
        <X className="size-3.5" />
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

/** Compact read-only strip for the home landing. Hidden when no goal is set. */
function CompactBar({progress}: {progress: DailyProgress}) {
  if (!progress.hasTarget) return null;
  const tier = TIER_UI[progress.tier];
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Target className={cn('size-4', tier.text)} />
          Today's target
        </div>
        <div className="text-sm tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">{formatPeso(progress.revenue)}</span> of {formatPeso(progress.target)}
        </div>
      </div>
      <ProgressTrack progress={progress} />
      <div className={cn('text-xs font-medium', tier.text)}>
        {progress.reached
          ? `Goal reached, ${formatPeso(progress.revenue - progress.target)} over`
          : `${Math.round(progress.rawPct)}% there, ${formatPeso(progress.remaining)} to go`}
      </div>
    </div>
  );
}

/** Full card with the goal editor, for the Offline Sales page. */
function FullBar({progress}: {progress: DailyProgress}) {
  const [editing, setEditing] = useState(false);
  const tier = TIER_UI[progress.tier];

  return (
    <Card>
      <CardContent className="py-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-muted">
              <Target className={cn('size-4', progress.hasTarget ? tier.text : 'text-muted-foreground')} />
            </span>
            <h3 className="text-sm font-semibold">Daily target</h3>
            {progress.hasTarget && (
              <span className={cn('rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold', tier.text)}>{tier.label}</span>
            )}
          </div>
          {editing ? (
            <TargetEditor current={progress.target} onDone={() => setEditing(false)} />
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-transform duration-150 ease-out hover:text-foreground active:scale-95"
            >
              <Pencil className="size-3" />
              {progress.hasTarget ? 'Edit goal' : 'Set goal'}
            </button>
          )}
        </div>

        {progress.hasTarget ? (
          <>
            <div className="mb-2.5 flex items-end justify-between gap-3">
              <div className="text-2xl font-semibold tabular-nums text-foreground">
                {formatPeso(progress.revenue)}
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">of {formatPeso(progress.target)}</span>
              </div>
              <div className={cn('text-lg font-semibold tabular-nums', tier.text)}>{Math.round(progress.rawPct)}%</div>
            </div>
            <ProgressTrack progress={progress} thick />
            <p className={cn('mt-2 text-sm font-medium', tier.text)}>
              {progress.reached
                ? `Goal reached. ${formatPeso(progress.revenue - progress.target)} over target, keep going.`
                : `${formatPeso(progress.remaining)} to go before today's goal.`}
            </p>
          </>
        ) : (
          <p className="py-2 text-sm text-muted-foreground">No daily goal set yet. Set one to track today's sales against it.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function DailyTargetBar({progress, variant}: {progress: DailyProgress; variant: Variant}) {
  return variant === 'compact' ? <CompactBar progress={progress} /> : <FullBar progress={progress} />;
}
