-- Smart pickup timing: when the guest is coming + when they were nudged.
-- Run in EACH tenant schema (r_luciz, r_justsmash) via the tenant project's SQL editor.
alter table orders add column if not exists pickup_eta_at timestamptz;
alter table orders add column if not exists pickup_nudge_at timestamptz;
create index if not exists idx_orders_pickup_due on orders (pickup_eta_at) where pickup_eta_at is not null and pickup_nudge_at is null;
