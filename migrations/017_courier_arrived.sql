-- 017: the driver page's "I've arrived" tap stamps when the rider reached the door.
-- Run against the TENANT database (sxthftiqvaojbdyjizjr).
alter table orders add column if not exists courier_arrived_at timestamptz;
