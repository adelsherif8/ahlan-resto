-- 027 — COD reconciliation columns on orders. Run in the tenant DB (sxthftiqvaojbdyjizjr).
-- The driver page records the cash actually received at the door; change is computed.
-- Code is tolerant before this runs (falls back to appending "COD: received X, change Y"
-- to order notes), but the dashboard's delivery analytics read these columns directly.

alter table if exists r_luciz.orders     add column if not exists cod_received numeric;
alter table if exists r_luciz.orders     add column if not exists cod_change   numeric;
alter table if exists r_justsmash.orders add column if not exists cod_received numeric;
alter table if exists r_justsmash.orders add column if not exists cod_change   numeric;
