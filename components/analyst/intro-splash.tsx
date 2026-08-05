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
    const t1 = setTimeout(() => setFading(true), 1700);
    const t2 = setTimeout(() => setGone(true), 2450);
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
        'fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background transition-opacity duration-700 ease-out',
        fading ? 'opacity-0' : 'opacity-100',
      )}
    >
      <div className="coop-intro-rise flex flex-col items-center text-center">
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
