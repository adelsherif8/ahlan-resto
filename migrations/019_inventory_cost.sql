-- 019: inventory countdown + item cost (menu engineering).
-- Run against the TENANT database (sxthftiqvaojbdyjizjr).
-- stock_count NULL = untracked (default); 0 = sold out (auto-86).
alter table menu_items add column if not exists stock_count integer;
alter table menu_items add column if not exists cost numeric; -- what the item costs to make, for margin math
