-- ============================================================================
-- 032: which plan each restaurant is on — CONTROL DB ONLY (npznnysudtkesnliibvl)
--
-- Do NOT run this in a tenant DB. The plan is a fact about OUR commercial
-- relationship with a restaurant, not part of their operational data:
--   • "who is near their order limit" must be ONE query over the control plane,
--     not one query per tenant schema;
--   • it has to stay readable when a tenant DB is unreachable (the ops rollup
--     already reports those tenants as `unreadable`);
--   • tenant schemas hold the restaurant's own data — diners, orders, menu. Our
--     pricing tier does not belong in a database we may hand over or restore.
--
-- Reviewed against supabase-postgres-best-practices:
--   • `text` + CHECK rather than varchar(n) or a pg enum — an enum type needs a
--     migration to add a value, a CHECK is one ALTER (schema-data-types);
--   • ADD COLUMN IF NOT EXISTS with no default → metadata-only, no table rewrite;
--   • Postgres has no ADD CONSTRAINT IF NOT EXISTS, so the CHECK goes in a DO
--     block that tests pg_constraint first (schema-constraints);
--   • deliberately NO index: `restaurants` holds a handful of rows and is read
--     whole by resolveAllRestaurants(). An index here would cost writes and
--     never be used.
-- ============================================================================

alter table restaurants add column if not exists plan text;
alter table restaurants add column if not exists plan_since date;
alter table restaurants add column if not exists plan_notes text;

comment on column restaurants.plan is
  'Billing plan: start | grow | chain. NULL = not yet sold/assigned. Prices and included-order counts live in the ops console (branding/pricing.md), never here.';
comment on column restaurants.plan_since is
  'First day this plan applies. Billing is calendar-month; the ops console counts orders from the 1st.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'restaurants_plan_check'
      and conrelid = 'public.restaurants'::regclass
  ) then
    alter table public.restaurants
      add constraint restaurants_plan_check
      check (plan is null or plan in ('start', 'grow', 'chain'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Assign the plans. These are TEMPLATES — the branch count only tells you what
-- the rate card says a restaurant "fits", not what was actually sold. A busy
-- single branch belongs on Grow. Set what the deal says, not what fits.
--
--   Just Smash (ahlan-pilot): 9 branches → rate card suggests 'chain'
--   Luci'z     (luciz):       1 branch  → rate card suggests 'start'
-- ---------------------------------------------------------------------------
-- update restaurants set plan = 'chain', plan_since = '2026-08-01' where slug = 'ahlan-pilot';
-- update restaurants set plan = 'start', plan_since = '2026-08-01' where slug = 'luciz';

-- verify
-- select slug, name, plan, plan_since from restaurants order by slug;
