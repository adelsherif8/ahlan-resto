-- Real prep/wait metrics need per-transition timestamps, not a single updated_at.
alter table orders add column if not exists started_at timestamptz;
alter table orders add column if not exists ready_at timestamptz;
alter table orders add column if not exists served_at timestamptz;
-- audit trail for cancellations (guest cancelled / out of stock / mistake / …)
alter table orders add column if not exists cancel_reason text;
