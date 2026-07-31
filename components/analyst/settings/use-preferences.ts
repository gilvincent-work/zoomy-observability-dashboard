'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {DEFAULT_PREFERENCES, mergePreferences, STORAGE_KEY, type StorePreferences} from '@/src/preferences';

type Updater = (prev: StorePreferences) => StorePreferences;

/**
 * MOCK persistence for store preferences — localStorage only. Starts from defaults
 * (so SSR and first client render match — no hydration mismatch), then loads any
 * saved value in an effect. Every change computes the next value inside the
 * functional setState updater and writes it through to storage there, so rapid
 * back-to-back updates always build on the latest state (no stale-closure clobber).
 * Swap this hook's body for a server read/write when real persistence lands; the
 * component API (prefs / update / reset / justSaved) stays the same.
 */
export function usePreferences() {
  const [prefs, setPrefs] = useState<StorePreferences>(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setPrefs(mergePreferences(JSON.parse(raw)));
    } catch {
      /* malformed storage — defaults stand */
    }
    setLoaded(true);
  }, []);

  const flashSaved = useCallback(() => {
    setJustSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setJustSaved(false), 1800);
  }, []);

  const writeThrough = (next: StorePreferences) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — mock only, safe to ignore */
    }
    return next;
  };

  const update = useCallback(
    (u: Updater) => {
      setPrefs((prev) => writeThrough(u(prev)));
      flashSaved();
    },
    [flashSaved],
  );

  const reset = useCallback(() => {
    setPrefs(() => writeThrough(DEFAULT_PREFERENCES));
    flashSaved();
  }, [flashSaved]);

  return {prefs, update, reset, loaded, justSaved};
}
