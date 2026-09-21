// Recharts-free constants/helpers shared between health-view.tsx (non-chart UI:
// channel cards, the segmented control, the cohort table) and the lazily-loaded
// health-view-chart.tsx. Kept here so the parent can import them WITHOUT pulling in
// the Recharts chunk (which would defeat the code-split).

export const CHANNEL_ACCENT: Record<string, string> = {shopee: '#EE4D2D', lazada: '#2F6BD4', website: '#2E7D5B', offline: '#C9873F'};

export const CHANNELS = [
  {key: 'shopee' as const, label: 'Shopee'},
  {key: 'lazada' as const, label: 'Lazada'},
  {key: 'website' as const, label: 'Website'},
];

export const shortMonth = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', {month: 'short', timeZone: 'UTC'});

export const hexToRgb = (hex: string) => {
  const h = hex.replace('#', '');
  return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`;
};
