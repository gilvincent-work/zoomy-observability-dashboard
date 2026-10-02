'use client';

import {useEffect, useState} from 'react';
import {Moon, Sun} from 'lucide-react';
import {ChatBlocks} from '@/components/analyst/chat-blocks';
import {previewGroups} from '@/components/analyst/chat-blocks.fixtures';

function Column({width}: {width: number}) {
  return (
    <div className="shrink-0 space-y-5 rounded-2xl border border-border bg-background p-4" style={{width}}>
      <h2 className="text-[13px] font-semibold text-foreground">{width}px wide</h2>
      {previewGroups.map((g) => (
        <div key={g.label} className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{g.label}</p>
          <ChatBlocks blocks={g.blocks} />
        </div>
      ))}
    </div>
  );
}

export function ChatBlocksPreview() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    setDark(next);
  };
  return (
    <main className="min-h-screen bg-background p-4">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-[15px] font-semibold text-foreground">Ask Coop blocks (dev preview, synthetic data)</h1>
        <button type="button" onClick={toggle} aria-pressed={dark} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          {dark ? 'Light' : 'Dark'}
        </button>
      </div>
      <div className="flex items-start gap-6 overflow-x-auto pb-6">
        <Column width={440} />
        <Column width={360} />
      </div>
    </main>
  );
}
