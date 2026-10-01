// LOCAL ONLY. Prints SQL that replaces the local pos_* sample data with the SYNTHETIC bundle fixture used by the unit tests
// (test/support/bundle-fixture.ts), so a local E2E has bundle orders, price history and SKUs. Never touches a hosted project:
// it only prints SQL; apply it with `... | docker exec -i coop-local-db psql -U postgres -d postgres`.
//   node --experimental-strip-types scripts/local-supabase/seed-bundles.mjs | docker exec -i coop-local-db psql -U postgres -d postgres -v ON_ERROR_STOP=1
import {buildBundleFixture, SKUS, PRICES, CHANGES} from '../../test/support/bundle-fixture.ts';

const q = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const fx = buildBundleFixture();
const all = [...fx.orders, ...Object.values(fx.special)];
const out = [];
out.push('begin;');
out.push('truncate public.pos_order_items, public.pos_orders, public.pos_products, public.pos_bundles, public.pos_prices, public.pos_price_changes, public.pos_events restart identity cascade;');
out.push(`insert into public.pos_products (product_id, name, product_line, category) values ${SKUS.map((s) => `(${q(s.product_id)}, ${q(s.name)}, 'Treats', 'Freeze-dried')`).join(', ')};`);
out.push("insert into public.pos_bundles (bundle_id, name, price) values ('b4','Buy Any 4',650),('b2','Buy Any 2',550);");
out.push(`insert into public.pos_prices (product_id, price, updated_by) values ${PRICES.map((p) => `(${q(p.product_id)}, ${p.price}, 'seed')`).join(', ')};`);
out.push(`insert into public.pos_price_changes (product_id, old_price, new_price, reason, changed_by, changed_at) values ${CHANGES.map((c) => `(${q(c.product_id)}, ${q(c.old_price)}, ${c.new_price}, 'seed', 'seed', ${q(c.changed_at)})`).join(', ')};`);
all.forEach((o, i) => {
  const id = 1000 + i;
  out.push(`insert into public.pos_orders (id, subtotal, discount, total, oversold, device_id, payment_method, customer_handle, status, remarks, created_at, event_id, pet_type) overriding system value values (${id}, ${o.subtotal}, ${q(o.discount)}, ${o.total}, false, 'seed', ${q(o.payment_method)}, null, ${q(o.status)}, null, ${q(o.created_at)}, ${q(o.event_id)}, ${q(o.pet_type)});`);
  for (const it of o.items) {
    out.push(`insert into public.pos_order_items (order_id, product_id, bundle_id, bundle_group, qty, unit_price, line_total) values (${id}, ${q(it.product_id)}, ${q(it.bundle_id ?? null)}, ${q(it.bundle_group ?? null)}, ${it.qty}, ${it.unit_price}, ${it.line_total});`);
  }
});
out.push("select setval(pg_get_serial_sequence('public.pos_orders','id'), 5000);");
out.push("notify pgrst, 'reload schema';");
out.push('commit;');
console.log(out.join('\n'));
