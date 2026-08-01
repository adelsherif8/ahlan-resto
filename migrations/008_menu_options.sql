-- TENANT project (sxthftiqvaojbdyjizjr) SQL editor — menu option groups.
--
-- A menu item can carry the questions a cashier would ask before it's orderable:
-- sandwich or combo, which size, which fries, which drink, and for a bundle,
-- which sandwiches go in it. The ORDER agent walks these one at a time and
-- prices the answers in code.
--
-- Shape of menu_items.options (array, asked in order):
-- [
--   { "key": "format", "label": "Sandwich or combo", "required": true,
--     "choices": [ { "name": "Sandwich only", "price": 120 },
--                  { "name": "Combo",         "price": 180 } ] },
--
--   { "key": "size", "label": "Combo size", "required": true,
--     "when": { "format": "Combo" },                 -- only asked if they chose Combo
--     "choices": [ { "name": "Small" }, { "name": "Medium", "delta": 15 } ] },
--
--   { "key": "side", "label": "Which fries", "when": { "format": "Combo" },
--     "choices": [ { "name": "French fries" }, { "name": "Diablo fries", "delta": 10 } ] },
--
--   { "key": "drink", "label": "Drink", "when": { "format": "Combo" },
--     "from_category": "Beverages" },                -- choices read off the live menu
--
--   { "key": "sandwiches", "label": "Pick your 4 sandwiches", "count": 4,
--     "choices": [ { "name": "American Truck" }, { "name": "Soo Classic" } ] }
-- ]
--
-- "price" replaces the item's base price; "delta" adds to it. Neither = free.
-- "count" > 1 asks for that many picks (repeats allowed). "when" gates a group on
-- an earlier answer. Empty/absent options = nothing to ask, order it as-is.

alter table menu_items add column if not exists options jsonb not null default '[]'::jsonb;

-- lets the dashboard show "needs setup" for items a guest can't fully order yet
create index if not exists idx_menu_items_options on menu_items using gin (options);
