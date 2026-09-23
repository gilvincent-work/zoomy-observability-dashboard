-- ---------------------------------------------------------------------------
-- Lazada upload ledger (admin dashboard)
--
-- Counts only — no names, phones, cities or order IDs. It exists because the
-- interesting figures about an import cannot be recovered from `lazada_orders`
-- afterwards: rows the parser rejected are deliberately never stored, so
-- "20 items skipped" and "13 buyers excluded because every order they placed was
-- canceled" are knowable at parse time and nowhere else. Without this table those
-- numbers vanish on the next page load, which is exactly when someone asks why
-- 604 spreadsheet rows became 214 buyers.
--
-- Storing the aggregates rather than the rejected rows is the point: the answer
-- is kept without retaining the PII of buyers this list will never contact.
--
-- One row per upload, so it doubles as an import history.
--
-- Safe to run on an existing install; the dashboard treats this table as
-- optional and simply omits the figures if it is absent.
-- ---------------------------------------------------------------------------

create table if not exists lazada_uploads (
  id               uuid primary key default gen_random_uuid(),
  uploaded_at      timestamptz not null default now(),
  file_name        text,
  rows_read        int not null default 0,
  items_saved      int not null default 0,
  buyers           int not null default 0,
  skipped_status   int not null default 0,
  skipped_phone    int not null default 0,
  skipped_date     int not null default 0,
  skipped_id       int not null default 0,
  excluded_buyers  int not null default 0
);

-- The dashboard reads only the most recent row.
create index if not exists idx_lazada_uploads_at on lazada_uploads (uploaded_at desc);

-- Enable, no policies => service role only.
alter table lazada_uploads enable row level security;
