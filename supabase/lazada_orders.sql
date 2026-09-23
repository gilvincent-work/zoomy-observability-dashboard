-- ---------------------------------------------------------------------------
-- Lazada order-item store (admin SMS-reminder dashboard)
--
-- One row per ORDER ITEM, exactly as the Lazada Seller-Center export ships it:
-- a 604-row export is ~270 orders from ~230 customers. Keeping the grain at the
-- item level means re-uploads and overlapping export windows are idempotent —
-- `order_item_id` is the natural key, so an upsert on it can never double-count
-- an order the way an auto-id insert would.
--
-- Customer aggregation (604 items -> 227 customers) is deliberately NOT
-- materialized here; the route's loader collapses by phone at read time so the
-- rollup logic stays in one testable place (app/lib/lazada-export.js).
--
-- PII: customer_name / phone / city are real customer data. RLS is enabled with
-- NO policies, which makes the table reachable only by the service role (the
-- Oxygen worker), and the page reading it is admin-gated. That is access
-- control, not consent — the Lazada-terms/consent sign-off is a separate gate.
--
-- NOTE (Coop): the storefront install added the money columns in a follow-up
-- migration (lazada_orders_add_money.sql). This file is the already-merged
-- shape — a fresh install needs nothing else.
-- ---------------------------------------------------------------------------

create table if not exists lazada_orders (
  order_item_id   text primary key,
  order_number    text,
  ordered_at      timestamptz not null,
  status          text,
  customer_name   text,
  city            text,
  phone           text not null,
  item_name       text,
  -- Order economics, straight from the export. `paid_price` is the buyer's actual
  -- outlay for this item, INCLUDING shipping and after discounts — summing it
  -- gives true spend, whereas adding shipping_fee on top would double-count.
  variation       text,
  paid_price      numeric(12,2),
  shipping_fee    numeric(12,2),
  pay_method      text,
  uploaded_at     timestamptz not null default now()
);

-- The dashboard reads every non-excluded row and groups by phone; ordered_at
-- backs the date-range tiles and the "most overdue first" default sort.
create index if not exists idx_lazada_orders_phone   on lazada_orders (phone);
create index if not exists idx_lazada_orders_ordered on lazada_orders (ordered_at);

-- Enable, no policies => service role only.
alter table lazada_orders enable row level security;
