-- Persistent geocode cache (control-plane, shared by all restaurants).
-- The in-memory cache in flows/src/services/delivery.js dies on every deploy, so a
-- repeat address ("بوينت ٩٠", "villa 12 narges") re-hit Photon/Nominatim (up to 6.5s).
-- Rows are tiny and the answer for a street never changes — cache them forever,
-- janitor-free. Run in the MUNADIM control-plane SQL editor (public schema).
create table if not exists public.geocode_cache (
  key        text primary key,          -- normalised query text
  result     jsonb,                     -- { lat, lng, source, label } or null (= known miss)
  created_at timestamptz not null default now()
);
-- flows talks to this table with the service key only; no anon/authenticated access
alter table public.geocode_cache enable row level security;
