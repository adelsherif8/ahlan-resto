-- TENANT project (sxthftiqvaojbdyjizjr) SQL editor — multi-branch support.
-- Every guest-facing record carries the branch it belongs to, so a branch only
-- ever sees (and is notified about) its own work.

alter table orders             add column if not exists branch text;
alter table reservations       add column if not exists branch text;
alter table diners             add column if not exists preferred_branch text;
alter table notifications      add column if not exists branch text;
alter table waitlist           add column if not exists branch text;
alter table restaurant_tables  add column if not exists branch text;

create index if not exists idx_orders_branch on orders(branch, created_at desc);
create index if not exists idx_reservations_branch on reservations(branch, date);
create index if not exists idx_notifications_branch on notifications(branch, created_at desc);

-- CONTROL PLANE project (npznnysudtkesnliibvl) — staff belong to one branch
-- (null = sees all branches, e.g. owners/area managers):
-- alter table restaurant_users add column if not exists branch text;
