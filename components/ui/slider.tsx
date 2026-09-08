import {Slider as SliderPrimitive} from '@base-ui/react/slider';

import {cn} from '@/lib/utils';

/**
 * Two-thumb range slider on the design tokens: a muted rail, a primary-filled
 * selected span, and solid thumbs that lift on drag/focus. `value` is always a
 * `[min, max]` pair. Commit-on-release is exposed via `onValueCommitted` so a
 * consumer can defer expensive work (e.g. a navigation) until the drag ends.
 */
export function RangeSlider({
  value,
  onValueChange,
  onValueCommitted,
  min,
  max,
  step = 1,
  className,
  'aria-label': ariaLabel,
}: {
  value: readonly [number, number];
  onValueChange?: (value: readonly number[]) => void;
  onValueCommitted?: (value: readonly number[]) => void;
  min: number;
  max: number;
  step?: number;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <SliderPrimitive.Root
      value={value as unknown as number[]}
      onValueChange={(v) => onValueChange?.(v as readonly number[])}
      onValueCommitted={(v) => onValueCommitted?.(v as readonly number[])}
      min={min}
      max={max}
      step={step}
      minStepsBetweenValues={1}
      className={cn('w-full', className)}
    >
      <SliderPrimitive.Control className="flex w-full touch-none items-center py-2 select-none">
        <SliderPrimitive.Track className="relative h-1.5 w-full rounded-full bg-muted">
          <SliderPrimitive.Indicator className="rounded-full bg-primary" />
          {[0, 1].map((i) => (
            <SliderPrimitive.Thumb
              key={i}
              index={i}
              getAriaLabel={() => (i === 0 ? 'Minimum price' : 'Maximum price')}
              aria-label={ariaLabel}
              className="size-4 rounded-full border-2 border-primary bg-background shadow-sm outline-none transition-[transform,box-shadow] focus-visible:ring-2 focus-visible:ring-ring/50 data-[dragging]:scale-110"
            />
          ))}
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}
