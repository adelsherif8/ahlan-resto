-- TENANT project (sxthftiqvaojbdyjizjr) — full ordering journey:
-- confirm → payment choice → receipt → status pushes.

alter table orders add column if not exists payment_method text;   -- cash | card | instapay
alter table orders add column if not exists receipt_url text;      -- PDF sent to the guest
alter table orders add column if not exists notified_status text;  -- last status pushed to the guest
alter table orders add column if not exists ready_at timestamptz;
alter table orders add column if not exists out_at timestamptz;    -- left for delivery

create index if not exists idx_orders_notify on orders(status, notified_status);
