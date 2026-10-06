'use client';

import Link from 'next/link';
import {usePathname, useRouter} from 'next/navigation';
import {NativeSelect} from '@/components/ui/native-select';
import {cn} from '@/lib/utils';

// Small shared pieces for the Goldline stock pages (Inventory counts / forecast,
// Action Feed, Health): the store picker and the Counts | Forecast tabs.

export const fmtDay = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'}) : '—';
export const fmtRange = (start: string, end: string) => `${fmtDay(start)}–${fmtDay(end)}, ${end.slice(0, 4)}`;
export const peso = (n: number) => `₱${Math.round(n).toLocaleString('en-US')}`;
export const compactPeso = (n: number) => `₱${new Intl.NumberFormat('en', {notation: 'compact', maximumFractionDigits: 1}).format(n)}`;

export function StorePicker({
  stores,
  value,
  allLabel,
  param = 'store',
}: {
  stores: Array<{code: string; name: string | null}>;
  value: string | null; // null = all stores (when allLabel is given)
  allLabel?: string;
  param?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <NativeSelect
      aria-label="Store"
      value={value ?? ''}
      onChange={(e) => router.push(e.target.value ? `${pathname}?${param}=${encodeURIComponent(e.target.value)}` : pathname)}
    >
      {allLabel && <option value="">{allLabel}</option>}
      {stores.map((s) => (
        <option key={s.code} value={s.code}>
          {s.name ? `${s.code} · ${s.name}` : `Store ${s.code}`}
        </option>
      ))}
    </NativeSelect>
  );
}

export function InventoryTabs({store}: {store: string | null}) {
  const pathname = usePathname();
  const q = store ? `?store=${encodeURIComponent(store)}` : '';
  const tabs = [
    {href: '/stock', label: 'Counts'},
    {href: '/stock/forecast', label: 'Forecast'},
  ];
  return (
    <nav aria-label="Inventory views" className="inline-flex rounded-md border p-0.5 text-xs">
      {tabs.map((t) => {
        const on = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={`${t.href}${q}`}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'rounded-[5px] px-2.5 py-1 font-medium transition-colors duration-150 ease-out',
              on ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function ToneChip({tone, children}: {tone: string | null; children: React.ReactNode}) {
  return (
    <span
      className={cn('inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap', !tone && 'bg-muted text-muted-foreground')}
      style={
        tone
          ? {color: `color-mix(in oklab, ${tone} 72%, var(--foreground))`, background: `color-mix(in oklab, ${tone} 14%, transparent)`}
          : undefined
      }
    >
      {children}
    </span>
  );
}
