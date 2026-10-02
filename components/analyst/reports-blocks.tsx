import {TriangleAlert} from 'lucide-react';
import type {RunBlock} from '@/src/reports-run';
import {ChatBlocks} from './chat-blocks';
import {layoutBlocks} from './reports-helpers';

/** What a block that cannot run shows. It never stops the other blocks. */
function BlockErrorCard({id, error}: {id: string; error: string}) {
  return (
    <section
      aria-label={`Block ${id}`}
      className="flex items-start gap-2 rounded-2xl border border-[color-mix(in_oklab,var(--status-warn)_45%,transparent)] bg-[color-mix(in_oklab,var(--status-warn)_8%,transparent)] p-3 text-[13px] leading-snug text-foreground"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" style={{color: 'var(--status-warn)'}} aria-hidden />
      <span className="min-w-0 break-words">This block can&apos;t be shown: {error}</span>
    </section>
  );
}

/**
 * A saved report's blocks, drawn by the same components the chat uses. Stat tiles wrap in one full-width row, charts sit
 * in two columns on wide screens, tables take the full width and scroll sideways inside their own box, and everything is
 * one column on a phone. Server component: no state, no data fetching.
 */
export function ReportBlocks({blocks}: {blocks: RunBlock[]}) {
  if (blocks.length === 0) return <p className="text-sm text-muted-foreground">This report has no blocks.</p>;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {layoutBlocks(blocks).map((item) => {
        switch (item.kind) {
          case 'kpis':
            return (
              <div key={item.key} className="min-w-0 lg:col-span-2">
                <ChatBlocks blocks={item.blocks} />
              </div>
            );
          case 'chart':
            return (
              <div key={item.key} className="min-w-0">
                <ChatBlocks blocks={[item.block]} />
              </div>
            );
          case 'table':
            return (
              <div key={item.key} className="min-w-0 lg:col-span-2">
                <ChatBlocks blocks={[item.block]} />
              </div>
            );
          case 'error':
            return (
              <div key={item.key} className="min-w-0">
                <BlockErrorCard id={item.id} error={item.error} />
              </div>
            );
        }
      })}
    </div>
  );
}
