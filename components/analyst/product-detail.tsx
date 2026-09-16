'use client';

// Per-product detail page: KPI cards, a six-month sales + stock chart (real:
// green bars = units sold, blue line = reconstructed end-of-month Stock Qty), the
// sold-by-month table, and this SKU's stock-in history. Reached by tapping a row
// on the merged Inventory page.

import Link from 'next/link';
import {Bar, ComposedChart, Line, CartesianGrid, XAxis, YAxis} from 'recharts';
import {ChartContainer, ChartTooltip, type ChartConfig} from '@/components/ui/chart';
import {cn} from '@/lib/utils';
import {formatPeso} from '@/src/pos-format';
import type {ProductDetail} from '@/src/pos-product-detail';
import type {ForecastStatus} from '@/src/pos-forecast-compute';

const STATUS: Record<ForecastStatus, {label: string; text: string}> = {
  healthy: {label: 'Healthy', text: 'text-emerald-600 dark:text-emerald-400'},
  low: {label: 'Low', text: 'text-amber-600 dark:text-amber-400'},
  out: {label: 'Out', text: 'text-red-600 dark:text-red-400'},
};
const chartConfig: ChartConfig = {
  sold: {label: 'Sold', color: 'var(--color-emerald-500, #10b981)'},
  stockEnd: {label: 'Stock Qty', color: '#3b6ea5'},
};
const when = (iso: string) => new Date(iso).toLocaleString('en-US', {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});

export function ProductDetailView({detail}: {detail: ProductDetail}) {
  const {product, forecast, series, receipts} = detail;
  const status = (forecast?.status ?? (product.stock <= 0 ? 'out' : 'healthy')) as ForecastStatus;
  const s = STATUS[status];
  const lastMonthSold = series.length >= 2 ? series[series.length - 2].sold : 0;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 md:px-10">
      <Link href="/inventory" className="font-mono text-xs text-primary hover:underline">‹ Back to inventory</Link>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{product.name}</h1>
      <div className="mt-1 font-mono text-[11px] text-muted-foreground">
        {product.product_id} · Stratpoint (Offline) · {formatPeso(product.price)}{!product.active && ' · unlisted'}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi big={String(product.stock)} lbl="Stock Qty now" tone={product.stock <= 0 ? 'crit' : undefined} />
        <Kpi big={s.label} lbl="status right now" small toneClass={s.text} />
        <Kpi big={String(lastMonthSold)} lbl="sold last month" />
        <Kpi big={forecast?.reorderQty != null ? String(forecast.reorderQty) : '—'} lbl="suggested order" tone={forecast?.reorderQty ? 'good' : undefined} />
      </div>

      <div className="mt-5 rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">Sales and stock, month by month</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Green bars: units sold. Blue line: Stock Qty at each month end, reconstructed from the movement ledger.</p>
        <ChartContainer config={chartConfig} className="mt-4 h-[240px] w-full">
          <ComposedChart data={series} margin={{left: 4, right: 8, top: 8, bottom: 0}}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
            <YAxis tickLine={false} axisLine={false} width={28} fontSize={11} />
            <ChartTooltip />
            <Bar dataKey="sold" fill="var(--color-sold)" radius={[3, 3, 0, 0]} maxBarSize={34} />
            <Line dataKey="stockEnd" stroke="var(--color-stockEnd)" strokeWidth={2.5} dot={{r: 3}} connectNulls />
          </ComposedChart>
        </ChartContainer>
        <p className="mt-2 text-[11px] text-muted-foreground">Lasts {forecast?.coverEventDays != null ? `~${Math.round(forecast.coverEventDays * 10) / 10} events` : '—'} · {forecast?.runsOutLabel ?? '—'}. Forward-looking forecast overlay lands in a later pass.</p>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">How many sold</h2>
          {series.every((m) => m.sold === 0) ? (
            <p className="text-sm text-muted-foreground">No sales in the last six months.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {[...series].reverse().map((m) => (
                  <tr key={m.month} className="border-b last:border-0">
                    <td className="py-2 font-mono text-xs text-muted-foreground">{m.month}</td>
                    <td className="py-2 text-right tabular-nums font-medium">{m.sold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">Stock history</h2>
          {receipts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stock adds recorded for this product.</p>
          ) : (
            <div className="flex flex-col">
              {receipts.slice(0, 8).map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 border-b py-2.5 text-sm last:border-0">
                  <span className="font-medium">{r.reason === 'add-void' ? 'Reversed add' : 'Added stock'}</span>
                  <span className={cn('font-mono text-sm font-bold tabular-nums', r.reason === 'add-void' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>
                    {r.reason === 'add-void' ? '' : '+'}{r.delta}
                  </span>
                  <span className="w-36 text-right font-mono text-[10.5px] leading-tight text-muted-foreground">
                    <span className="block font-semibold text-foreground/80">{r.created_by ?? 'unknown'}</span>
                    {when(r.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({big, lbl, small, tone, toneClass}: {big: string; lbl: string; small?: boolean; tone?: 'crit' | 'good'; toneClass?: string}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className={cn('font-bold leading-none', small ? 'text-base' : 'text-2xl', tone === 'crit' && 'text-red-600 dark:text-red-400', tone === 'good' && 'text-emerald-600 dark:text-emerald-400', toneClass)}>{big}</div>
      <div className="mt-1.5 text-xs text-muted-foreground">{lbl}</div>
    </div>
  );
}
