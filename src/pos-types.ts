// Shapes for the Product Controls page. A PosProductRow is one product joined
// with its current price (pos_prices) and live stock (pos_inventory view).

export interface PosProductRow {
  product_id: string; // SKU Code, the stable key
  name: string;
  product_line: string | null; // FDR / JRK / MEAT (Coop's SKU-decode line)
  category: string | null; // POS display tab — authoritative for the POS
  subcategory: string | null; // POS secondary tab (Freeze-Dried only)
  emoji: string | null; // 1-3 emoji for the POS tile; null = POS default
  active: boolean; // listed / unlisted
  price: number | null;
  stock: number; // Σ qty_on_hand across lots
  next_expiry: string | null; // earliest expiry with stock, ISO date
}

/** A bundle synced from the POS (pos_bundles + its items). */
export interface PosBundleRow {
  bundle_id: string; // the POS's shared bundle_uuid
  name: string;
  price: number;
  active: boolean;
  bundle_type: 'fixed' | 'pick';
  pick_count: number | null; // Buy Any N (pick bundles)
  line_categories: string[] | null; // eligible POS lines (pick bundles)
  emoji: string | null; // tile emoji; null = derived from lines on the POS
  items: {product_id: string; name: string; qty: number}[]; // fixed-bundle contents
}
