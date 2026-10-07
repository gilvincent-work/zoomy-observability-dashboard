// Which data each dashboard page shows, for the per-turn context (spec F.2). Pure, no imports.
// Source: knowledge/data-catalog/pages.md. Train 3 replaces PAGES with the generated catalog.json; keep the shape.
export type PageInfo = {route: string; title: string; shows: string; data: string};

export const PAGES: readonly PageInfo[] = [
  {route: '/', title: 'Sales overview', shows: 'channel KPIs (Shopee, Lazada, Website, Offline) for a digest period or custom range', data: 'digest_archive, pos_orders, CRM orders'},
  {route: '/traffic', title: 'Traffic', shows: 'traffic block (sample data only)', data: 'digest_archive; traffic is mock'},
  {route: '/health', title: 'Business Health', shows: 'per-channel quality of revenue with editable knobs', data: 'business_health, pos_orders'},
  {route: '/repricer', title: 'Repricer', shows: 'repricer runs and per-variant price history', data: 'marketplace_price_changes'},
  {route: '/offline-sales', title: 'Offline sales', shows: 'POS revenue KPIs, target, rankings, event rollups, prizes, low-stock strip', data: 'pos_orders, pos_order_items, pos_events, pos_stock_movements, pos_inventory_by_location'},
  {route: '/offline-sales/orders', title: 'Transactions', shows: 'POS transaction list with filters', data: 'pos_orders, pos_order_items, pos_order_prizes'},
  {route: '/offline-sales/events', title: 'Events', shows: 'sales per event, cash reconciliation, booth leads', data: 'pos_events, pos_orders, spin_wheel_leads'},
  {route: '/offline-sales/rankings', title: 'Rankings', shows: 'top products and bundles (offline)', data: 'pos_orders, pos_order_items, pos_products, pos_bundles'},
  {route: '/inventory', title: 'Inventory', shows: 'stock on hand, by location (event = sellable, office = back stock), forecast, bundles, intake, transfers', data: 'pos_inventory, pos_inventory_by_location, pos_stock_movements, pos_products'},
  {route: '/inventory/[sku]', title: 'Product detail', shows: 'one product: stock by location, movement and price history, forecast', data: 'pos_products, pos_stock_movements, pos_orders'},
  {route: '/customers/all', title: 'All customers', shows: 'merged contacts across website CRM, Lazada uploads and booth leads', data: 'CRM customers and orders, lazada_orders, spin_wheel_leads'},
  {route: '/customers/website-crm', title: 'Website CRM', shows: 'website customers, orders, abandoned checkouts, vouchers', data: 'CRM API only (not readable by Ask Coop yet)'},
  {route: '/customers/leads', title: 'Booth leads', shows: 'booth leads matched to orders and prizes', data: 'spin_wheel_leads, pos_orders, pos_order_prizes'},
  {route: '/customers/lazada', title: 'Lazada contacts', shows: 'Lazada contacts from uploaded exports', data: 'lazada_orders'},
  {route: '/reports', title: 'Saved reports', shows: 'gallery of saved Ask Coop reports', data: 'coop_reports'},
  {route: '/reports/[id]', title: 'Saved report', shows: 'one saved report re-run on live data', data: 'coop_reports, coop_chat_* views'},
];

const MAX_PATH = 200;
const MAX_QUERY = 300;
const MAX_PAIRS = 5;
const PATH_RE = /^\/(?!\/)[\w\-./[\]]*$/;
const MAX_LINKS = 3;

/** Exact route, or a single dynamic segment (`[x]`). Never a word prefix. */
export function resolvePage(path: string): PageInfo | null {
  const clean = path.split('?')[0].replace(/\/+$/, '') || '/';
  const parts = clean.split('/');
  for (const p of PAGES) {
    const r = p.route.split('/');
    if (r.length === parts.length && r.every((seg, i) => seg === parts[i] || /^\[.+\]$/.test(seg))) return p;
  }
  return null;
}

/** Allow-list for a query string that reaches the model: short plain key=value pairs only, at most 5. */
function safeQuery(raw: string): string {
  const out: string[] = [];
  for (const [k, v] of new URLSearchParams(raw)) {
    if (/^[a-z_]{1,20}$/.test(k) && /^[\w.:-]{1,40}$/.test(v)) out.push(`${k}=${v}`);
    if (out.length === MAX_PAIRS) break;
  }
  return out.join('&');
}

/** Untrusted client input -> a safe {path, query} or null. */
export function readPageInput(raw: unknown): {path: string; query: string} | null {
  if (raw === null || typeof raw !== 'object') return null;
  const {path, query} = raw as {path?: unknown; query?: unknown};
  if (typeof path !== 'string' || path.length > MAX_PATH || !PATH_RE.test(path)) return null;
  const q = typeof query === 'string' && query.length <= MAX_QUERY ? safeQuery(query) : '';
  return {path, query: q};
}

/** Dashboard links (same host only) pasted in a message, as path?query, at most 3. */
export function dashboardLinks(text: string, host: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')]+/g)) {
    let u: URL;
    try { u = new URL(m[0]); } catch { continue; }
    if (u.host !== host) continue;
    if (u.pathname.length > MAX_PATH || !PATH_RE.test(u.pathname) || !resolvePage(u.pathname)) continue;
    const q = u.search.length <= MAX_QUERY + 1 ? safeQuery(u.search) : '';
    out.push(q ? `${u.pathname}?${q}` : u.pathname);
    if (out.length === MAX_LINKS) break;
  }
  return out;
}

const describe = (p: PageInfo): string => `${p.title}: shows ${p.shows}; data: ${p.data}`;

/** One per-turn line, or null when no known page is in play. Never goes in the cached system prompt. */
export function pageContextLine(current: {path: string; query: string} | null, pasted: string[]): string | null {
  const parts: string[] = [];
  const cur = current ? resolvePage(current.path) : null;
  if (current && cur) parts.push(`The owner is on ${current.path}${current.query ? `?${current.query}` : ''} (${describe(cur)}).`);
  for (const link of pasted) {
    const p = resolvePage(link);
    if (p) parts.push(`They pasted a link to ${link} (${describe(p)}).`);
  }
  return parts.length ? `[page] ${parts.join(' ')} Read "this" and "here" as that page's data.` : null;
}
