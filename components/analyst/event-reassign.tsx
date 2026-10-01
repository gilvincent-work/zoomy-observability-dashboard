'use client';

import {useState, useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {Loader2} from 'lucide-react';
import type {PosEvent, PosOrder} from '@/src/pos-sales-types';
import {reassignOrderEventAction} from '@/src/pos-events-actions';
import {formatPeso} from '@/src/pos-format';
import {manilaDayKey, orderMethod} from '@/src/pos-sales-compute';

/** "Sep 16, 2:40 PM" (Manila) for a reassign row. */
function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = new Date(manilaDayKey(iso) + 'T00:00:00Z').toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});
  const time = d.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila'});
  return `${day}, ${time}`;
}

/**
 * Correct a sale's event attribution (multi-event). Each row is one order with a
 * dropdown to move it to another event or untag it, through reassignOrderEventAction
 * (set_pos_order_event RPC). Used both inside an event card (fix a sale tagged to
 * the wrong same-day event) and in the Untagged bucket (assign a blank sale).
 * Voided sales are not shown (reassigning them is meaningless). Scrolls past ~8 rows.
 */
export function ReassignList({orders, events}: {orders: PosOrder[]; events: PosEvent[]}) {
  const live = orders.filter((o) => o.status !== 'voided');
  if (live.length === 0) return null;
  return (
    <div className="max-h-80 divide-y overflow-y-auto rounded-lg border">
      {live.map((o) => (
        <ReassignRow key={o.id} order={o} events={events} />
      ))}
    </div>
  );
}

function ReassignRow({order, events}: {order: PosOrder; events: PosEvent[]}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function move(value: string) {
    const next = value || null;
    if (next === (order.event_id ?? null)) return;
    setError(null);
    startTransition(async () => {
      const res = await reassignOrderEventAction(order.id, next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
      <div className="flex items-center gap-2 tabular-nums">
        <span className="text-muted-foreground">{timeLabel(order.created_at)}</span>
        <span className="font-medium">{formatPeso(order.total)}</span>
        <span className="text-muted-foreground">{orderMethod(order)}</span>
      </div>
      <div className="flex items-center gap-2">
        {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Saving" />}
        <select
          className="rounded-md border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          value={order.event_id ?? ''}
          onChange={(e) => move(e.target.value)}
          disabled={pending}
          aria-label="Move sale to event"
        >
          <option value="">Untagged</option>
          {events.map((ev) => (
            <option key={ev.event_id} value={ev.event_id}>
              {ev.venue?.trim() || ev.name || 'Untitled event'}
            </option>
          ))}
        </select>
      </div>
      {error && <span className="w-full text-destructive">{error}</span>}
    </div>
  );
}
