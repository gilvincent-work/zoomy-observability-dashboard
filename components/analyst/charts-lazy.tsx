'use client';

// Lazy wrappers around the Recharts charts in ./charts. Recharts (~110 kB gzipped)
// was riding in the initial JS of every route that renders a Tab or the overview
// sections (they import ./charts statically). Loading the charts via next/dynamic
// moves the whole Recharts graph into an async chunk fetched after first paint, so
// the initial bundle drops toward the shared baseline on all those routes.
//
// ssr:false because these are client-only visuals with no SEO value; a
// height-matched skeleton holds the layout so deferring the chart causes no CLS.
// Consumers import the SAME names from here instead of './charts'.
import dynamic from 'next/dynamic';
import {cn} from '@/lib/utils';

function ChartSkeleton({className}: {className?: string}) {
  return <div className={cn('w-full animate-pulse rounded-lg bg-muted/40', className)} aria-hidden />;
}

export const RevenueForecastChart = dynamic(() => import('./charts').then((m) => m.RevenueForecastChart), {
  ssr: false,
  loading: () => <ChartSkeleton className="h-full min-h-[220px]" />,
});

export const TopSkusChart = dynamic(() => import('./charts').then((m) => m.TopSkusChart), {
  ssr: false,
  loading: () => <ChartSkeleton className="h-[220px]" />,
});

export const TrafficDonut = dynamic(() => import('./charts').then((m) => m.TrafficDonut), {
  ssr: false,
  loading: () => <ChartSkeleton className="mx-auto aspect-square h-[220px]" />,
});

export const ConversionFunnel = dynamic(() => import('./charts').then((m) => m.ConversionFunnel), {
  ssr: false,
  loading: () => <ChartSkeleton className="h-[200px]" />,
});
