'use client';

import {useEffect, useState} from 'react';
import {Moon, Sun} from 'lucide-react';
import {Button} from '@/components/ui/button';

const KEY = 'zoomy-theme';

// Day/night toggle. The initial class is set by the inline seed script in
// app/layout.tsx (no flash); this only reflects + flips it after hydration.
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(KEY, next ? 'dark' : 'light');
    } catch {
      /* private mode — the class still applies for this session */
    }
    setDark(next);
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {/* Both icons render; CSS shows the one for the active theme (avoids a
          hydration mismatch since the seed script decides the class pre-paint). */}
      <Sun className="size-5 dark:hidden" />
      <Moon className="hidden size-5 dark:block" />
    </Button>
  );
}
