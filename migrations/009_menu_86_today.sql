-- "Sold out today" is different from "off the menu": the item auto-returns and
-- the bot says so honestly instead of pretending the dish doesn't exist.
alter table menu_items add column if not exists sold_out_until date;
