-- Run in the RESTAURANT tenant project (sxthftiqvaojbdyjizjr) SQL editor.
-- 1) Richer menu knowledge for the waiter brain (all optional — empty = bot says "team will confirm")
-- 2) Staff quality signal on AI replies (👍/👎 in the dashboard Chats page)

alter table menu_items add column if not exists ingredients text;
alter table menu_items add column if not exists spice_level int;      -- 0-3 (null = unknown)
alter table menu_items add column if not exists bestseller boolean not null default false;
alter table menu_items add column if not exists pairs_with text;      -- e.g. "Passionfruit Mojito"

alter table chat_messages add column if not exists rating smallint;   -- 1 = 👍, -1 = 👎 (staff on AI replies)
