'use client';

import {useEffect, useState} from 'react';
import {usePathname, useRouter, useSearchParams} from 'next/navigation';
import {Popover} from '@base-ui/react/popover';
import {CalendarDays, ChevronDown, X} from 'lucide-react';
import {cn} from '@/lib/utils';
import {Button} from '@/components/ui/button';
import {Calendar, type DateRange} from '@/components/ui/calendar';
import {fmtRange} from '../../src/week';
import {periodDays} from '../../src/custom-range';

/**
 * "Custom dates" beside the reporting-period switcher: narrows the Overview to
 * PH days inside the selected period, via `?from=&to=` (YYYY-MM-DD). Days outside
 * the period are disabled; the page clamps and recomputes what it can (see
 * src/custom-range.ts).
 */
export function CustomRangePicker({windowFrom, windowTo}: {windowFrom: string; windowTo: string}) {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const searchParams = useSearchParams();
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const active = Boolean(from && to);
  const {min, max} = periodDays(windowFrom, windowTo);

  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DateRange>({start: from, end: to});
  useEffect(() => setRange({start: from, end: to}), [from, to]);

  function push(next: {from: string; to: string} | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) {
      params.set('from', next.from);
      params.set('to', next.to);
    } else {
      params.delete('from');
      params.delete('to');
    }
    router.push(`${pathname}?${params.toString()}`, {scroll: false});
    setOpen(false);
  }

  return (
    <div className="inline-flex items-center">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          className={cn(
            'inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted',
            active ? 'border-primary/50 pr-8 text-foreground' : 'border-border text-foreground/80',
          )}
        >
          <CalendarDays className="size-3.5 text-muted-foreground" />
          <span className={cn('text-xs', active ? 'font-mono tabular-nums' : 'font-medium')}>
            {active ? fmtRange(from as string, to as string) : 'Custom dates'}
          </span>
          {!active && <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start" sideOffset={8}>
            <Popover.Popup className="z-50 w-72 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg outline-none">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {range.start && !range.end ? 'Pick an end date' : 'Dates within this period'}
              </div>
              <p className="mb-3 text-[11px] leading-snug text-muted-foreground">
                Website and Offline recalculate. Lazada and Shopee stay full-period for now.
              </p>
              <Calendar value={range} onChange={setRange} min={min} max={max} />
              <Button
                size="sm"
                className="mt-3 w-full"
                disabled={!range.start}
                onClick={() => range.start && push({from: range.start, to: range.end ?? range.start})}
              >
                Apply
              </Button>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {active && (
        <button
          type="button"
          onClick={() => push(null)}
          aria-label="Clear custom dates"
          className="-ml-7 grid size-5 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
