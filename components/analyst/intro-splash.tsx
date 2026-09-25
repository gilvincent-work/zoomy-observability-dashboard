'use client';

import {useEffect, useState} from 'react';
import {cn} from '@/lib/utils';

/**
 * Coop title card — shown on full page load, then fades to reveal the dashboard.
 * SSR-rendered so it covers the app from the very first paint (no flash of the
 * dashboard behind it). Persists across client-side tab navigation (it lives in
 * the root layout), so it only reappears on an actual page load.
 */
export function IntroSplash() {
  const [fading, setFading] = useState(false); // opacity → 0
  const [gone, setGone] = useState(false); // unmounted after the fade

  useEffect(() => {
    // Once per session. The pre-paint script in app/layout.tsx adds
    // `coop-splash-seen` to <html> when sessionStorage says a prior load already
    // showed it — so on repeat loads within a session the splash is hidden before
    // first paint (no flash) and we unmount it immediately here (skipping the
    // timers). First load of a session: show it, but briefly.
    const seen = document.documentElement.classList.contains('coop-splash-seen');
    try {
      sessionStorage.setItem('coop-splash-seen', '1');
    } catch {}
    if (seen) {
      setGone(true);
      return;
    }
    const t1 = setTimeout(() => setFading(true), 600);
    const t2 = setTimeout(() => setGone(true), 1100);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (gone) return null;

  return (
    <div
      aria-hidden
      className={cn(
        // The whole overlay crossfades out over the (already-present) dashboard.
        'coop-splash fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background transition-opacity duration-[500ms] ease-out',
        fading ? 'opacity-0' : 'opacity-100',
      )}
    >
      <div
        className={cn(
          // The title card gently scales up + softens as it leaves — feels like it
          // lifts away to reveal the app, rather than a hard cut.
          'coop-intro-rise flex flex-col items-center text-center transition-[transform,filter] duration-[500ms] ease-out will-change-transform',
          fading ? 'scale-[1.05] blur-[3px]' : 'scale-100 blur-0',
        )}
      >
        <span className="font-sans text-[3.25rem] font-extrabold leading-none tracking-tight text-foreground">
          co<span style={{color: 'var(--primary)'}}>o</span>p
        </span>
        <h1 className="mt-6 font-serif text-[2.5rem] font-normal leading-tight tracking-tight text-foreground">
          The Brand Operating System
        </h1>
        <p className="mt-3 text-[15px] text-muted-foreground">A new way to run a brand.</p>
      </div>
    </div>
  );
}
