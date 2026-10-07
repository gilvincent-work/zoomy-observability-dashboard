-- Goldline upload batches: one store's inventory form for one period, uploaded in one
-- sitting (several page PDFs, or one multi-page PDF split into pages in the browser).
-- Store + period are entered ONCE for the batch (prefilled from page 1's printed
-- header) and every page inherits them, so all pages commit into one Inventory count.
--
-- Additive only: a new table + a nullable FK column on gl_uploads (existing uploads
-- keep batch_id = null and behave as before). RLS on, no policies, revoked from the
-- API roles — service-role only, like the other gl_* tables. Staging first.

create table if not exists public.gl_upload_batches (
  id           uuid primary key default gen_random_uuid(),
  company_id   text not null references public.companies(id) on delete cascade,
  store_code   text,
  period_start date,
  period_end   date,
  status       text not null default 'open' check (status in ('open', 'committed')),
  created_by   text,
  created_at   timestamptz not null default now(),
  committed_at timestamptz,
  constraint gl_upload_batches_period_order check (period_start is null or period_end is null or period_start <= period_end)
);
create index if not exists gl_upload_batches_company_idx on public.gl_upload_batches (company_id, created_at desc);

alter table public.gl_uploads add column if not exists batch_id uuid references public.gl_upload_batches(id) on delete set null;
create index if not exists gl_uploads_batch_idx on public.gl_uploads (batch_id);

alter table public.gl_upload_batches enable row level security;
revoke all on public.gl_upload_batches from anon, authenticated;

comment on table public.gl_upload_batches is
  'One store''s inventory form for one period, uploaded together; pages inherit store + period. Service-role only.';
