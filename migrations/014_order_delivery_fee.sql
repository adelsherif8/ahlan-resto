-- Persist the delivery fee as its own column so receipts and reports can
-- rebuild the itemized bill without re-deriving it from config-of-the-day.
alter table orders add column if not exists delivery_fee numeric;
