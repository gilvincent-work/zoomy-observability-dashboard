'use client';

import {useEffect, useState} from 'react';
import Link from 'next/link';
import {usePathname, useRouter, useSearchParams} from 'next/navigation';
import {Popover} from '@base-ui/react/popover';
import {ChevronDown, SlidersHorizontal, X} from 'lucide-react';
import {cn} from '@/lib/utils';
import {Button} from '@/components/ui/button';
import {RangeSlider} from '@/components/ui/slider';
import {formatPeso} from '@/src/pos-format';
import {ORDER_METHOD_FILTERS, isFilterActive} from '@/src/pos-sales-compute';
import type {PosOrdersFilter, PriceBounds, SalesRange} from '@/src/pos-sales-types';

const DATE_FILTERS: {value: SalesRange; label: string}[] = [
  {value: 'all', label: 'All'},
  {value: 'today', label: 'Today'},
  {value: '7d', label: '7 days'},
  {value: '30d', label: '30 days'},
];

/**
 * Filter bar above the transactions list: payment-method pills, a date-range
 * preset, and a price-range popover. Every control writes to the URL search
 * params (and resets to page 1) so the server re-queries a filtered, paginated
 * slice. The whole bar reads back from those same params, so it's shareable and
 * survives a refresh.
 */
export function TransactionFilters({filter, bounds}: {filter: PosOrdersFilter; bounds: PriceBounds}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /** Clone the current params, apply a patch, and always return to page 1. */
  function hrefWith(patch: Record<string, string | null>): string {
    const params = new URLSearchParams(searchParams?.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value == null || value === '') params.delete(key);
      else params.set(key, value);
    }
    params.delete('page');
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  const anyActive = isFilterActive(filter);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3">
      <Group label="Method">
        <Segmented
          items={ORDER_METHOD_FILTERS}
          active={filter.method}
          hrefFor={(value) => hrefWith({method: value === 'all' ? null : value})}
        />
      </Group>

      <Group label="When">
        <Segmented
          items={DATE_FILTERS}
          active={filter.range}
          hrefFor={(value) => hrefWith({range: value === 'all' ? null : value})}
        />
      </Group>

      <Group label="Price">
        <PriceFilter filter={filter} bounds={bounds} hrefWith={hrefWith} router={router} />
      </Group>

      {anyActive && (
        <Link
          href={hrefWith({method: null, range: null, min: null, max: null})}
          scroll={false}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3.5" /> Clear filters
        </Link>
      )}
    </div>
  );
}

function Group({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  items,
  active,
  hrefFor,
}: {
  items: {value: T; label: string}[];
  active: T;
  hrefFor: (value: T) => string;
}) {
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {items.map((it) => (
        <Link
          key={it.value}
          href={hrefFor(it.value)}
          scroll={false}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
            it.value === active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {it.label}
        </Link>
      ))}
    </div>
  );
}

function PriceFilter({
  filter,
  bounds,
  hrefWith,
  router,
}: {
  filter: PosOrdersFilter;
  bounds: PriceBounds;
  hrefWith: (patch: Record<string, string | null>) => string;
  router: ReturnType<typeof useRouter>;
}) {
  const priceActive = filter.minPrice != null || filter.maxPrice != null;
  const shownMin = filter.minPrice ?? bounds.min;
  const shownMax = filter.maxPrice ?? bounds.max;
  const step = bounds.max > 200 ? 10 : 1;

  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<[number, number]>([shownMin, shownMax]);

  // Re-sync the draft when the applied filter or dataset bounds change (e.g.
  // after navigation, or a Clear filters press elsewhere in the bar).
  useEffect(() => {
    setRange([shownMin, shownMax]);
  }, [shownMin, shownMax]);

  function clamp(n: number): number {
    if (!Number.isFinite(n)) return bounds.min;
    return Math.min(bounds.max, Math.max(bounds.min, Math.round(n)));
  }

  function apply() {
    const [lo, hi] = range[0] <= range[1] ? range : [range[1], range[0]];
    router.push(
      hrefWith({
        min: lo <= bounds.min ? null : String(lo),
        max: hi >= bounds.max ? null : String(hi),
      }),
      {scroll: false},
    );
    setOpen(false);
  }

  function reset() {
    setRange([bounds.min, bounds.max]);
    router.push(hrefWith({min: null, max: null}), {scroll: false});
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
          priceActive ? 'border-primary/50 text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <SlidersHorizontal className="size-3" />
        {priceActive ? `${formatPeso(shownMin)} – ${formatPeso(shownMax)}` : 'Any price'}
        <ChevronDown className="size-3 opacity-60" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={8}>
          <Popover.Popup className="z-50 w-64 rounded-lg border bg-popover p-4 text-popover-foreground shadow-md outline-none">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Price range</span>
              {priceActive && (
                <button
                  type="button"
                  onClick={reset}
                  className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Reset
                </button>
              )}
            </div>

            <div className="mb-1 flex items-center gap-2">
              <MoneyInput
                label="Minimum price"
                value={range[0]}
                onCommit={(n) => setRange(([, hi]) => [clamp(n), hi])}
              />
              <span className="text-muted-foreground">–</span>
              <MoneyInput
                label="Maximum price"
                value={range[1]}
                onCommit={(n) => setRange(([lo]) => [lo, clamp(n)])}
              />
            </div>

            <RangeSlider
              value={range}
              onValueChange={([lo, hi]) => setRange([lo, hi])}
              min={bounds.min}
              max={bounds.max}
              step={step}
            />

            <Button size="sm" className="mt-3 w-full" onClick={apply}>
              Apply
            </Button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Small ₱-prefixed number field; commits on change (parent clamps the value). */
function MoneyInput({label, value, onCommit}: {label: string; value: number; onCommit: (n: number) => void}) {
  return (
    <div className="relative flex-1">
      <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs text-muted-foreground">₱</span>
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        value={value}
        onChange={(e) => onCommit(Number(e.target.value))}
        className="h-8 w-full rounded-md border bg-background pr-2 pl-5 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
    </div>
  );
}
