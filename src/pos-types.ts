// Shapes for the Product Controls page. A PosProductRow is one product joined
// with its current price (pos_prices) and live stock (pos_inventory view).

export interface PosProductRow {
  product_id: string; // SKU Code, the stable key
  name: string;
  product_line: string | null; // FDR / JRK / MEAT (Coop's SKU-decode line)
  category: string | null; // POS display tab — authoritative for the POS
  subcategory: string | null; // POS secondary tab (Freeze-Dried only)
  active: boolean; // listed / unlisted
  price: number | null;
  stock: number; // Σ qty_on_hand across lots
  next_expiry: string | null; // earliest expiry with stock, ISO date
}
