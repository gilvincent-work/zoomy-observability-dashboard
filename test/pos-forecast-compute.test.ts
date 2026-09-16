import {describe, it, expect} from 'vitest';
import {
  computeForecast,
  velocityByProduct,
  urgentForecastRows,
  effectiveThreshold,
  effectiveMultiplier,
  computeSurge,
  nextEventDay,
  DEFAULT_FORECAST_CONFIG,
  DEFAULT_NEXT_EVENT_PLAN,
  type ForecastProduct,
  type SaleMovement,
  type NextEventPlan,
} from '../src/pos-forecast-compute';

// A fixed "now" on a non-event weekday (Mon Sep 14 2026, mid-morning Manila) so
// run-out projection has to walk forward to the next Fri/Sat/Sun.
const NOW = new Date('2026-09-14T04:00:00Z'); // 12:00 PM Manila

function product(over: Partial<ForecastProduct> & {product_id: string; stock: number}): ForecastProduct {
  return {name: over.product_id, product_line: null, category: null, subcategory: null, emoji: null, ...over};
}

// A product that sold `qty` units on each of `days` distinct event-days.
function salesOn(product_id: string, qtyPerDay: number, days: string[]): SaleMovement[] {
  return days.map((day) => ({product_id, qty: qtyPerDay, day}));
}

describe('velocityByProduct', () => {
  it('divides by distinct selling days, not calendar days', () => {
    const moves = salesOn('A', 3, ['2026-09-05', '2026-09-06', '2026-09-07']); // one bazaar weekend
    const v = velocityByProduct(moves).get('A');
    expect(v).toEqual({units: 9, days: 3});
  });
  it('ignores zero/negative qty rows', () => {
    const v = velocityByProduct([{product_id: 'A', qty: 0, day: '2026-09-05'}]).get('A');
    expect(v).toBeUndefined();
  });
});

describe('computeForecast — status bands', () => {
  const moves = [
    ...salesOn('OUT', 2, ['2026-09-06']),
    ...salesOn('LOWCOUNT', 1, ['2026-09-06']),
    ...salesOn('LOWCOVER', 5, ['2026-09-05', '2026-09-06']), // 5/day
    ...salesOn('HEALTHY', 2, ['2026-09-05', '2026-09-06']),
  ];
  const products = [
    product({product_id: 'OUT', stock: 0}),
    product({product_id: 'LOWCOUNT', stock: 8}), // ≤ threshold 10
    product({product_id: 'LOWCOVER', stock: 12}), // >10 but 12/5 = 2.4 event-days ≤ 3
    product({product_id: 'HEALTHY', stock: 60}), // 60/2 = 30 event-days
  ];
  const {rows, summary} = computeForecast(products, moves, NOW);
  const byId = Object.fromEntries(rows.map((r) => [r.product_id, r]));

  it('flags zero stock as Out', () => {
    expect(byId.OUT.status).toBe('out');
    expect(byId.OUT.runsOutLabel).toBe('Now');
  });
  it('flags on-hand ≤ threshold as Low', () => {
    expect(byId.LOWCOUNT.status).toBe('low');
  });
  it('flags fast-mover with little cover as Low even above the count threshold', () => {
    expect(byId.LOWCOVER.status).toBe('low');
    expect(byId.LOWCOVER.coverEventDays).toBeCloseTo(2.4, 5);
  });
  it('leaves well-stocked slow-movers Healthy', () => {
    expect(byId.HEALTHY.status).toBe('healthy');
    expect(byId.HEALTHY.reorderQty).toBeNull();
  });
  it('summarizes the counts', () => {
    expect(summary).toEqual({healthy: 1, low: 2, out: 1, total: 4});
  });
});

describe('computeForecast — no sales history', () => {
  it('shows infinite cover and no run-out for a stocked product that never sold', () => {
    const {rows} = computeForecast([product({product_id: 'IDLE', stock: 40})], [], NOW);
    expect(rows[0].coverEventDays).toBeNull();
    expect(rows[0].soldPerEventDay).toBe(0);
    expect(rows[0].runsOutLabel).toBe('No recent sales');
    expect(rows[0].status).toBe('healthy');
  });
});

describe('computeForecast — run-out lands on an event-day', () => {
  it('projects the stockout onto the next Fri/Sat/Sun, never a dead weekday', () => {
    // 5 on hand, 3.1/event-day → ~1.6 event-days of cover. From Mon Sep 14, the
    // next event-days are Fri Sep 18, Sat Sep 19… so it runs out on Sat Sep 19.
    const moves = salesOn('S', 3.1, ['2026-09-06']);
    const {rows} = computeForecast([product({product_id: 'S', stock: 5})], moves, NOW);
    const wd = new Date(rows[0].runsOut + 'T00:00:00Z').getUTCDay();
    expect(DEFAULT_FORECAST_CONFIG.eventWeekdays).toContain(wd);
    expect(rows[0].runsOut).toBe('2026-09-19'); // Saturday
  });
});

describe('computeForecast — reorder', () => {
  it('reorders up to the target cover window and dates it by lead time', () => {
    const moves = salesOn('R', 4, ['2026-09-05', '2026-09-06']); // 4/event-day
    const {rows} = computeForecast([product({product_id: 'R', stock: 6})], moves, NOW);
    // target 6 event-days × 4 = 24; minus 6 on hand → reorder 18
    expect(rows[0].reorderQty).toBe(18);
    expect(rows[0].reorderBy).not.toBeNull();
    // reorder-by is lead-time days before run-out
    expect(rows[0].reorderBy! < rows[0].runsOut!).toBe(true);
  });
});

describe('effectiveThreshold — per-SKU overrides', () => {
  it('uses a SKU override when present, else the global default', () => {
    const config = {...DEFAULT_FORECAST_CONFIG, threshold: 10, thresholdOverrides: {A: 3}};
    expect(effectiveThreshold(config, 'A')).toBe(3);
    expect(effectiveThreshold(config, 'B')).toBe(10);
  });
  it('flips a product Low↔Healthy at its override, not the global', () => {
    const moves = salesOn('A', 1, ['2026-09-06']);
    const product5 = product({product_id: 'A', stock: 5});
    // Global 10 → 5 on hand is Low; override to 3 → 5 on hand is Healthy.
    const globalLow = computeForecast([product5], moves, NOW, {...DEFAULT_FORECAST_CONFIG});
    const overridden = computeForecast([product5], moves, NOW, {
      ...DEFAULT_FORECAST_CONFIG,
      thresholdOverrides: {A: 3},
    });
    expect(globalLow.rows[0].status).toBe('low');
    expect(overridden.rows[0].status).toBe('healthy');
  });
});

describe('effectiveMultiplier — global vs category', () => {
  const plan: NextEventPlan = {...DEFAULT_NEXT_EVENT_PLAN, multiplier: 2, byCategory: {'Freeze Dried': 4}};
  it('prefers a category override, else the global multiplier', () => {
    expect(effectiveMultiplier(plan, 'Freeze Dried')).toBe(4);
    expect(effectiveMultiplier(plan, 'Meaty Treats')).toBe(2);
    expect(effectiveMultiplier(plan, null)).toBe(2);
  });
});

describe('nextEventDay — this vs next weekend', () => {
  it('returns the first upcoming event-day when eventThisWeekend is on', () => {
    // From Mon Sep 14 the next event-day is Fri Sep 18.
    const d = nextEventDay({...DEFAULT_NEXT_EVENT_PLAN, eventThisWeekend: true}, DEFAULT_FORECAST_CONFIG.eventWeekdays, NOW);
    expect(d).toBe('2026-09-18');
  });
  it('rolls to the following weekend when eventThisWeekend is off', () => {
    const d = nextEventDay({...DEFAULT_NEXT_EVENT_PLAN, eventThisWeekend: false}, DEFAULT_FORECAST_CONFIG.eventWeekdays, NOW);
    expect(d).toBe('2026-09-25'); // Fri of the next weekend
  });
});

describe('computeSurge', () => {
  const moves = salesOn('S', 4, ['2026-09-05', '2026-09-06']); // 4/event-day
  const {rows} = computeForecast([product({product_id: 'S', category: 'Freeze Dried', stock: 8})], moves, NOW);

  it('scales base per-event demand by the multiplier and flags shortfall', () => {
    // base per-event demand = 4/day × 3 event-days = 12; ×3 = 36 expected; 8 on hand → short 28.
    const {rows: surge, summary} = computeSurge(rows, {...DEFAULT_NEXT_EVENT_PLAN, multiplier: 3}, DEFAULT_FORECAST_CONFIG, NOW);
    const s = surge.get('S')!;
    expect(s.expected).toBe(36);
    expect(s.short).toBe(28);
    expect(s.sustains).toBe(false);
    expect(s.manual).toBe(false);
    expect(summary.shortCount).toBe(1);
    expect(summary.restockBy).not.toBeNull();
  });

  it('honors a per-product absolute quantity over the multiplier', () => {
    const plan = {...DEFAULT_NEXT_EVENT_PLAN, multiplier: 3, byProduct: {S: 15}};
    const s = computeSurge(rows, plan, DEFAULT_FORECAST_CONFIG, NOW).rows.get('S')!;
    expect(s.expected).toBe(15);
    expect(s.short).toBe(7);
    expect(s.manual).toBe(true);
  });

  it('sustains when on-hand covers the expected demand', () => {
    const big = computeForecast([product({product_id: 'S', stock: 500})], moves, NOW);
    const {summary} = computeSurge(big.rows, {...DEFAULT_NEXT_EVENT_PLAN, multiplier: 3}, DEFAULT_FORECAST_CONFIG, NOW);
    expect(summary.shortCount).toBe(0);
    expect(summary.restockBy).toBeNull();
  });
});

describe('urgentForecastRows', () => {
  it('returns only non-healthy rows, worst first, capped', () => {
    const moves = [...salesOn('A', 5, ['2026-09-06']), ...salesOn('B', 1, ['2026-09-06'])];
    const products = [
      product({product_id: 'A', stock: 0}),
      product({product_id: 'B', stock: 5}),
      product({product_id: 'C', stock: 500}),
    ];
    const {rows} = computeForecast(products, moves, NOW);
    const urgent = urgentForecastRows(rows, 4);
    expect(urgent.every((r) => r.status !== 'healthy')).toBe(true);
    expect(urgent[0].status).toBe('out');
  });
});
