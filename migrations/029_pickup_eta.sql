-- Smart pickup timing: when the guest is coming + when they were nudged.
-- Schema-qualified — paste ONCE in the tenant project's SQL editor, covers both restaurants.
alter table r_luciz.orders     add column if not exists pickup_eta_at   timestamptz;
alter table r_luciz.orders     add column if not exists pickup_nudge_at timestamptz;
create index if not exists idx_orders_pickup_due_luciz on r_luciz.orders (pickup_eta_at) where pickup_eta_at is not null and pickup_nudge_at is null;

alter table r_justsmash.orders add column if not exists pickup_eta_at   timestamptz;
alter table r_justsmash.orders add column if not exists pickup_nudge_at timestamptz;
create index if not exists idx_orders_pickup_due_justsmash on r_justsmash.orders (pickup_eta_at) where pickup_eta_at is not null and pickup_nudge_at is null;
