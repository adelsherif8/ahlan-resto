-- Patch for the partially-applied run: ONLY the pieces the DB is missing
-- (verified column-by-column on 2026-08-04). Idempotent — safe to re-run.

alter table orders add column if not exists delivered_at timestamptz;
alter table orders add column if not exists courier_name text;
alter table orders add column if not exists courier_phone text;
alter table orders add column if not exists courier_token text;
alter table orders add column if not exists courier_lat double precision;
alter table orders add column if not exists courier_lng double precision;
alter table orders add column if not exists courier_seen_at timestamptz;
alter table orders add column if not exists eta_extra_min int;
create index if not exists idx_orders_courier_token on orders (courier_token) where courier_token is not null;

-- couriers landed with the old column name — bring it onto the invariant
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'couriers' and column_name = 'phone')
     and not exists (select 1 from information_schema.columns where table_name = 'couriers' and column_name = 'phone_number') then
    alter table couriers rename column phone to phone_number;
  end if;
end $$;

-- verify: both selects should succeed
select delivered_at, courier_token, eta_extra_min from orders limit 1;
select phone_number from couriers limit 1;
