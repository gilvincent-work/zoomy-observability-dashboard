#!/usr/bin/env node
// READ-ONLY snapshot of what the lead ↔ POS order matcher needs, to a local
// JSON file: spin-wheel leads, POS orders in a date window with their items,
// product/bundle names, and won prizes. Only .select() calls — nothing is
// written to the database.
//
//   node --env-file=.env.local scripts/export-lead-match-data.mjs <out.json> [from] [to]
//   (from/to are PH dates, default 2026-09-18 .. 2026-09-28)
//
// The output is contact + sales data — keep it out of the repo.
import {writeFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';

const [out, from = '2026-09-18', to = '2026-09-28'] = process.argv.slice(2);
if (!out) {
  console.error('usage: node scripts/export-lead-match-data.mjs <out.json> [from] [to]');
  process.exit(1);
}
const url = process.env.SUPABASE_URL_ARCHIVE;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY_ARCHIVE;
if (!url || !key) throw new Error('SUPABASE_URL_ARCHIVE / SUPABASE_SERVICE_ROLE_KEY_ARCHIVE not set');
const db = createClient(url, key, {auth: {persistSession: false}});

const start = `${from}T00:00:00+08:00`;
const end = `${to}T23:59:59+08:00`;

/** Page past PostgREST's 1000-row cap; `build` gets a fresh query per page. */
async function all(label, build) {
  const rows = [];
  for (let i = 0; ; i += 1000) {
    const {data, error} = await build().range(i, i + 999);
    if (error) throw new Error(`${label}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

const orders = await all('pos_orders', () =>
  db.from('pos_orders')
    .select('id,client_uuid,total,discount,payment_method,customer_handle,status,remarks,created_at,event_id,pet_type')
    .gte('created_at', start).lte('created_at', end)
    .order('created_at').order('id'));
const ids = orders.map((o) => o.id);

const items = [];
for (let i = 0; i < ids.length; i += 200) {
  items.push(...await all('pos_order_items', () =>
    db.from('pos_order_items')
      .select('id,order_id,product_id,bundle_id,bundle_group,qty,unit_price,line_total')
      .in('order_id', ids.slice(i, i + 200)).order('id')));
}

const [leads, products, bundles, prizes] = await Promise.all([
  all('spin_wheel_leads', () => db.from('spin_wheel_leads').select('*').order('collected_at').order('lead_id')),
  all('pos_products', () => db.from('pos_products').select('product_id,name').order('product_id')),
  all('pos_bundles', () => db.from('pos_bundles').select('bundle_id,name').order('bundle_id')),
  all('pos_order_prizes', () => db.from('pos_order_prizes').select('order_id,product_id,qty,won_at,voided_at').gte('won_at', start).lte('won_at', end).order('won_at').order('order_id')),
]);

writeFileSync(out, JSON.stringify({from, to, leads, orders, items, products, bundles, prizes}, null, 1));
console.log(`wrote ${out}: ${leads.length} leads, ${orders.length} orders, ${items.length} items, ${prizes.length} prizes`);
