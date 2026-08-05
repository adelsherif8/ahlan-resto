-- 018: POS money features — discounts, tips, cashier attribution, split payments.
-- Run against the TENANT database (sxthftiqvaojbdyjizjr).
alter table orders add column if not exists discount numeric;
alter table orders add column if not exists discount_reason text;
alter table orders add column if not exists tip numeric;
alter table orders add column if not exists cashier text;
alter table orders add column if not exists payments jsonb; -- split payments: [{"method":"cash","amount":100}]
