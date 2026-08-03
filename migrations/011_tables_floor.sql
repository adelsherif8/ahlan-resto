-- Floor upgrades: a block/maintenance note on a table, and a manual arrange
-- order so the on-screen layout can mirror the actual room.
alter table restaurant_tables add column if not exists note text;
alter table restaurant_tables add column if not exists pos int;
