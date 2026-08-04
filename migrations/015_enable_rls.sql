-- ============================================================================
-- 015: Enable RLS everywhere + strip anon/authenticated privileges.
--
-- Per supabase-postgres-best-practices (security-rls-basics, CRITICAL):
-- every table in an exposed schema must have RLS enabled — tables in `public`
-- are reachable through the Data API. Our architecture only ever touches the
-- tenant DB with SERVICE-ROLE keys (backend + flows, both server-side), and
-- service_role has BYPASSRLS — so enabling RLS with NO policies blocks the
-- anon/authenticated roles entirely with zero effect on the running product.
--
-- Belt and braces (security-privileges, least privilege): also revoke the
-- default table grants from anon/authenticated. Storage buckets (menus,
-- receipts, menu-photos) are unaffected — public buckets serve via the
-- storage CDN, not via table grants.
--
-- Run in BOTH databases:
--   • tenant DB   (sxthftiqvaojbdyjizjr)
--   • control DB  (npznnysudtkesnliibvl — restaurants, restaurant_users)
--
-- Deliberately NOT using FORCE row level security: the SQL editor runs as the
-- table owner, and FORCE would subject your own editor queries to the (empty)
-- policies.
-- ============================================================================

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- Verify (should show rowsecurity = true for every table):
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
