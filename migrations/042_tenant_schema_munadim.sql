-- 042: MUNADIM — the platform's own flagship restaurant (takes over the 19331 /
-- wpid 842784625592396 WhatsApp number from Luci'z once seeded + tested).
-- !! RUN ON THE **TENANT** DB (sxthftiqvaojbdyjizjr) — same paste as 023/024.
-- Same schema-per-tenant shape as r_luciz / r_justsmash; LIKE ... INCLUDING ALL
-- keeps it structurally identical to the live tables by construction.

create schema if not exists r_munadim;

create table if not exists r_munadim.diners                (like public.diners                including all);
create table if not exists r_munadim.reservations          (like public.reservations          including all);
create table if not exists r_munadim.restaurant_tables     (like public.restaurant_tables     including all);
create table if not exists r_munadim.temp_reservation      (like public.temp_reservation      including all);
create table if not exists r_munadim.waitlist              (like public.waitlist              including all);
create table if not exists r_munadim.menu_items            (like public.menu_items            including all);
create table if not exists r_munadim.orders                (like public.orders                including all);
create table if not exists r_munadim.events                (like public.events                including all);
create table if not exists r_munadim.feedback              (like public.feedback              including all);
create table if not exists r_munadim.chat_sessions         (like public.chat_sessions         including all);
create table if not exists r_munadim.chat_messages         (like public.chat_messages         including all);
create table if not exists r_munadim.message_full          (like public.message_full          including all);
create table if not exists r_munadim.messages_buffer       (like public.messages_buffer       including all);
create table if not exists r_munadim.suggested_faqs        (like public.suggested_faqs        including all);
create table if not exists r_munadim.flow_executions       (like public.flow_executions       including all);
create table if not exists r_munadim.notifications         (like public.notifications         including all);
create table if not exists r_munadim.couriers              (like public.couriers              including all);
create table if not exists r_munadim.routing_failures      (like public.routing_failures      including all);
create table if not exists r_munadim.pending_message_queue (like public.pending_message_queue including all);

grant usage on schema r_munadim to anon, authenticated, service_role;
grant all privileges on all tables    in schema r_munadim to service_role;
grant all privileges on all sequences in schema r_munadim to service_role;
alter default privileges in schema r_munadim grant all on tables    to service_role;
alter default privileges in schema r_munadim grant all on sequences to service_role;

-- RLS on, no anon/authenticated access — service key only (same posture as 015/023/024)
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'r_munadim' loop
    execute format('alter table r_munadim.%I enable row level security', t);
    execute format('revoke all on r_munadim.%I from anon, authenticated', t);
  end loop;
end $$;

-- PostgREST must expose the schema (Dashboard: Settings → API → Exposed schemas)
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, r_luciz, r_justsmash, r_munadim';
notify pgrst, 'reload config';
