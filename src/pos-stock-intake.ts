import 'server-only';
import {cache} from 'react';
import {unstable_noStore as noStore} from 'next/cache';
import {posClient, usingPosMock} from './pos-data';
import {MOCK_POS_PRODUCTS} from './pos-mock';

// SERVER-ONLY. Reads the stock-in history (Add-stock receipts + their reversals)
// from the pos_stock_movements ledger for the Stock history views (Q19). Mirrors
// src/pos-data.ts: service-role env, or a deterministic mock when unset.

export interface StockReceipt {
  id: number;
  product_id: string;
  name: string;
  delta: number; // + for a receipt, - for an add-void reversal
  reason: 'receipt' | 'add-void';
  created_by: string | null;
  created_at: string; // ISO
}

/** Recent stock-in movements (adds + reversals), newest first, product names resolved. */
export const getStockReceipts = cache(async (limit = 100): Promise<StockReceipt[]> => {
  noStore();
  if (usingPosMock()) return mockReceipts();

  const supabase = posClient();
  const [movesRes, productsRes] = await Promise.all([
    supabase
      .from('pos_stock_movements')
      .select('id,product_id,delta,reason,created_by,created_at')
      .in('reason', ['receipt', 'add-void'])
      .order('id', {ascending: false})
      .limit(limit),
    supabase.from('pos_products').select('product_id,name'),
  ]);
  if (movesRes.error) throw new Error(`pos_stock_movements read failed: ${movesRes.error.message}`);
  if (productsRes.error) throw new Error(`pos_products read failed: ${productsRes.error.message}`);

  const nameBySku = new Map<string, string>();
  for (const p of productsRes.data ?? []) nameBySku.set(p.product_id as string, p.name as string);

  return (movesRes.data ?? []).map((m) => ({
    id: Number(m.id),
    product_id: m.product_id as string,
    name: nameBySku.get(m.product_id as string) ?? (m.product_id as string),
    delta: Number(m.delta ?? 0),
    reason: (m.reason as string) === 'add-void' ? 'add-void' : 'receipt',
    created_by: (m.created_by as string | null) ?? null,
    created_at: m.created_at as string,
  }));
});

// Deterministic mock history so the panels/drawer render without a DB.
function mockReceipts(): StockReceipt[] {
  const base = Date.parse('2026-09-16T01:24:00Z');
  const pick = (i: number) => MOCK_POS_PRODUCTS[i % MOCK_POS_PRODUCTS.length];
  const rows: {sku: string; qty: number; who: string; ago: number}[] = [
    {sku: pick(0).product_id, qty: 40, who: 'maria@zoomycoop.com', ago: 0},
    {sku: pick(1).product_id, qty: 24, who: 'maria@zoomycoop.com', ago: 0},
    {sku: pick(3).product_id, qty: 36, who: 'maria@zoomycoop.com', ago: 0},
    {sku: pick(9).product_id, qty: 100, who: 'juan@zoomycoop.com', ago: 4 * 86_400_000},
    {sku: pick(1).product_id, qty: 30, who: 'juan@zoomycoop.com', ago: 4 * 86_400_000},
  ];
  return rows.map((r, i) => ({
    id: 1000 - i,
    product_id: r.sku,
    name: MOCK_POS_PRODUCTS.find((p) => p.product_id === r.sku)?.name ?? r.sku,
    delta: r.qty,
    reason: 'receipt' as const,
    created_by: r.who,
    created_at: new Date(base - r.ago).toISOString(),
  }));
}
