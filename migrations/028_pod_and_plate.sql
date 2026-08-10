-- 028 — proof-of-delivery + courier plate. Run in the tenant DB (sxthftiqvaojbdyjizjr).
-- pod_url: photo the rider snaps at the door when marking delivered (dispute protection).
-- plate: the courier's vehicle plate — shown to the CUSTOMER on the tracking page so they
-- know exactly who/what to expect at the door (trust + safety).
-- Code is tolerant before this runs (upload succeeds, the column update is best-effort).

alter table if exists r_luciz.orders       add column if not exists pod_url text;
alter table if exists r_justsmash.orders   add column if not exists pod_url text;
alter table if exists r_luciz.couriers     add column if not exists plate text;
alter table if exists r_justsmash.couriers add column if not exists plate text;
