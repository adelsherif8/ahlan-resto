-- The delivery leg: courier hand-off, driver link auth, door-to-door timestamps,
-- and the driver's last known position.
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
