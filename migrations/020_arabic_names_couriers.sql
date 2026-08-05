-- 020: Arabic item names + full courier profiles + courier assignment on orders.
-- Run against the TENANT database (sxthftiqvaojbdyjizjr).
alter table menu_items add column if not exists name_ar text;
alter table couriers add column if not exists vehicle text;
alter table couriers add column if not exists national_id text;
alter table couriers add column if not exists notes text;
alter table couriers add column if not exists active boolean default true;
alter table orders add column if not exists courier_id uuid;
