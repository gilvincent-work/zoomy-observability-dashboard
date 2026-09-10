'use client';

import {useEffect, useState} from 'react';
import {Popover} from '@base-ui/react/popover';
import {ChevronDown, Search, SlidersHorizontal, X} from 'lucide-react';
import {cn} from '@/lib/utils';
import {Button} from '@/components/ui/button';
import {RangeSlider} from '@/components/ui/slider';
import {SUBCATEGORY_CATEGORY} from '@/src/pos-format';
import {
  DEFAULT_PRODUCT_FILTER,
  PRODUCT_CATEGORY_FILTERS,
  PRODUCT_STATUS_FILTERS,
  PRODUCT_SUBCATEGORY_FILTERS,
  isProductFilterActive,
  type ProductFilter,
} from '@/src/pos-product-filter';

/**
 * Filter bar above the Product Controls table: a name/SKU search, category +
 * (Freeze-Dried-only) subcategory pills, a listed/unlisted status pill, and a
 * stock-range popover. Unlike the transactions filter bar, this is local
 * component state rather than URL params — the whole catalog is already loaded
 * (no pagination), so narrowing it is just an in-memory filter of rows already
 * on the page.
 */
export function ProductFilters({
  filter,
  onChange,
  stockMax,
}: {
  filter: ProductFilter;
  onChange: (next: ProductFilter) => void;
  stockMax: number;
}) {
  const anyActive = isProductFilterActive(filter);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3">
      <Group label="Search">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filter.search}
            onChange={(e) => onChange({...filter, search: e.target.value})}
            placeholder="Name or SKU…"
            aria-label="Search products by name or SKU"
            className="h-7 w-44 rounded-md border bg-background pr-2 pl-7 text-xs outline-none focus-visible:border-ring"
          />
        </div>
      </Group>

      <Group label="Category">
        <Segmented
          items={PRODUCT_CATEGORY_FILTERS}
          active={filter.category}
          onSelect={(category) =>
            onChange({...filter, category, subcategory: category === SUBCATEGORY_CATEGORY ? filter.subcategory : ''})
          }
        />
      </Group>

      {filter.category === SUBCATEGORY_CATEGORY && (
        <Group label="Subcategory">
          <Segmented
            items={PRODUCT_SUBCATEGORY_FILTERS}
            active={filter.subcategory}
            onSelect={(subcategory) => onChange({...filter, subcategory})}
          />
        </Group>
      )}

      <Group label="Status">
        <Segmented
          items={PRODUCT_STATUS_FILTERS}
          active={filter.status}
          onSelect={(status) => onChange({...filter, status})}
        />
      </Group>

      <Group label="Stock">
        <StockFilter filter={filter} max={stockMax} onChange={onChange} />
      </Group>

      {anyActive && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_PRODUCT_FILTER)}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3.5" /> Clear filters
        </button>
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
  onSelect,
}: {
  items: {value: T; label: string}[];
  active: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          onClick={() => onSelect(it.value)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
            it.value === active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function StockFilter({
  filter,
  max,
  onChange,
}: {
  filter: ProductFilter;
  max: number;
  onChange: (next: ProductFilter) => void;
}) {
  const active = filter.minStock != null || filter.maxStock != null;
  const shownMin = filter.minStock ?? 0;
  const shownMax = filter.maxStock ?? max;

  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<[number, number]>([shownMin, shownMax]);

  // Re-sync the draft when the applied filter or dataset bounds change (e.g.
  // after Clear filters, or the stock ceiling moving as rows are edited).
  useEffect(() => {
    setRange([shownMin, shownMax]);
  }, [shownMin, shownMax]);

  function apply() {
    const [lo, hi] = range[0] <= range[1] ? range : [range[1], range[0]];
    onChange({...filter, minStock: lo <= 0 ? null : lo, maxStock: hi >= max ? null : hi});
    setOpen(false);
  }

  function reset() {
    setRange([0, max]);
    onChange({...filter, minStock: null, maxStock: null});
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
          active ? 'border-primary/50 text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <SlidersHorizontal className="size-3" />
        {active ? `${shownMin} – ${shownMax}` : 'Any stock'}
        <ChevronDown className="size-3 opacity-60" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={8}>
          <Popover.Popup className="z-50 w-64 rounded-lg border bg-popover p-4 text-popover-foreground shadow-md outline-none">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Stock range</span>
              {active && (
                <button
                  type="button"
                  onClick={reset}
                  className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Reset
                </button>
              )}
            </div>

            <div className="mb-1 flex items-center justify-between text-xs tabular-nums text-muted-foreground">
              <span>{range[0]}</span>
              <span>{range[1]}</span>
            </div>
            <RangeSlider
              value={range}
              onValueChange={([lo, hi]) => setRange([lo, hi])}
              min={0}
              max={max}
              step={1}
              aria-label="Stock range"
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
