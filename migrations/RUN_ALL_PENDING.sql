-- ============================================================================
-- ONE-PASTE runner: everything pending, in order, idempotent (safe to re-run).
-- Paste into the TENANT DB SQL editor (sxthftiqvaojbdyjizjr) and run once.
-- Then run ONLY the 015 section again in the CONTROL DB (npznnysudtkesnliibvl).
--
-- Reviewed against supabase-postgres-best-practices:
--   • every ADD COLUMN is IF NOT EXISTS, no defaults that rewrite the table —
--     metadata-only changes, instant even on large tables
--   • the one index (courier_token) is partial (WHERE ... IS NOT NULL), tiny
--   • RLS block is service-role-safe (see 015 header)
-- ============================================================================

-- ---- 009: "sold out today" ≠ "off the menu" ----
alter table menu_items add column if not exists sold_out_until date;

-- ---- 010: real prep/wait metrics need per-transition timestamps ----
alter table orders add column if not exists started_at timestamptz;
alter table orders add column if not exists ready_at timestamptz;
alter table orders add column if not exists served_at timestamptz;
alter table orders add column if not exists cancel_reason text;

-- ---- 011: floor — block/maintenance note + manual arrange order ----
alter table restaurant_tables add column if not exists note text;
alter table restaurant_tables add column if not exists pos int;

-- ---- 012: the delivery leg (driver link, stamps, breadcrumbs) ----
alter table orders add column if not exists out_at timestamptz;
alter table orders add column if not exists delivered_at timestamptz;
alter table orders add column if not exists courier_name text;
alter table orders add column if not exists courier_phone text;
alter table orders add column if not exists courier_token text;
alter table orders add column if not exists courier_lat double precision;
alter table orders add column if not exists courier_lng double precision;
alter table orders add column if not exists courier_seen_at timestamptz;
alter table orders add column if not exists eta_extra_min int;
create index if not exists idx_orders_courier_token on orders (courier_token) where courier_token is not null;

-- ---- 013: courier roster (phone column follows the phone_number invariant) ----
create table if not exists couriers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone_number text,
  branch text,
  active boolean default true,
  created_at timestamptz default now()
);

-- ---- 014: delivery fee persisted as data ----
alter table orders add column if not exists delivery_fee numeric;

-- ---- 015: enable RLS everywhere + least privilege (run in BOTH DBs) ----
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ---- verify ----
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
