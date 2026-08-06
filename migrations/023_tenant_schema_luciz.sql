-- 023: SECOND RESTAURANT — schema-per-tenant inside the SAME Supabase project.
-- !! RUN ON THE **TENANT** DB (sxthftiqvaojbdyjizjr) — the one that already
-- holds Just Smash in `public`.
--
-- Why this shape: a separate Supabase PROJECT per restaurant costs ~$10/month
-- each and would push us off the free tier at restaurant #2. A separate SCHEMA
-- costs nothing, keeps each restaurant's tables physically distinct (a query in
-- one schema can never see another's rows), and Just Smash needs no migration —
-- it simply stays in `public`.
--
-- LIKE ... INCLUDING ALL copies columns, types, defaults, constraints and
-- indexes from the live Just Smash tables, so the new tenant is structurally
-- identical by construction rather than by a hand-written guess.

create schema if not exists r_luciz;

create table if not exists r_luciz.diners                (like public.diners                including all);
create table if not exists r_luciz.reservations          (like public.reservations          including all);
create table if not exists r_luciz.restaurant_tables     (like public.restaurant_tables     including all);
create table if not exists r_luciz.temp_reservation      (like public.temp_reservation      including all);
create table if not exists r_luciz.waitlist              (like public.waitlist              including all);
create table if not exists r_luciz.menu_items            (like public.menu_items            including all);
create table if not exists r_luciz.orders                (like public.orders                including all);
create table if not exists r_luciz.events                (like public.events                including all);
create table if not exists r_luciz.feedback              (like public.feedback              including all);
create table if not exists r_luciz.chat_sessions         (like public.chat_sessions         including all);
create table if not exists r_luciz.chat_messages         (like public.chat_messages         including all);
create table if not exists r_luciz.message_full          (like public.message_full          including all);
create table if not exists r_luciz.messages_buffer       (like public.messages_buffer       including all);
create table if not exists r_luciz.suggested_faqs        (like public.suggested_faqs        including all);
create table if not exists r_luciz.flow_executions       (like public.flow_executions       including all);
create table if not exists r_luciz.notifications         (like public.notifications         including all);
create table if not exists r_luciz.couriers              (like public.couriers              including all);
create table if not exists r_luciz.routing_failures      (like public.routing_failures      including all);
create table if not exists r_luciz.pending_message_queue (like public.pending_message_queue including all);

-- the API roles must be able to reach the new schema
grant usage on schema r_luciz to anon, authenticated, service_role;
grant all privileges on all tables    in schema r_luciz to service_role;
grant all privileges on all sequences in schema r_luciz to service_role;
alter default privileges in schema r_luciz grant all on tables    to service_role;
alter default privileges in schema r_luciz grant all on sequences to service_role;

-- Same posture as migration 015: RLS on everywhere, no anon/authenticated grants.
-- Only the service-role key (held by our backend) touches tenant data.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'r_luciz' loop
    execute format('alter table r_luciz.%I enable row level security', t);
    execute format('revoke all on r_luciz.%I from anon, authenticated', t);
  end loop;
end $$;

-- PostgREST must be told the schema exists, otherwise the API returns 404s.
-- (Dashboard equivalent: Settings → API → Exposed schemas → add r_luciz)
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, r_luciz';
notify pgrst, 'reload config';
