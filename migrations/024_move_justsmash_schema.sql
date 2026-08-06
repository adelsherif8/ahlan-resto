-- 024: give Just Smash a NAMED schema too, so no restaurant is special-cased.
-- !! RUN ON THE **TENANT** DB (sxthftiqvaojbdyjizjr), AFTER migration 023.
--
-- `public` holding one restaurant's data is a leftover from when there was only
-- one. ALTER TABLE ... SET SCHEMA is a catalog change: it moves no rows and
-- takes seconds, but the bot will 404 for a few seconds between the move and
-- the control-plane row being updated — run it in a quiet minute.
--
-- AFTER running this, tell Claude so the restaurants row is switched to
-- schema = "r_justsmash" in the same minute (or do it yourself in the control
-- plane: integrations.supabase.schema).

create schema if not exists r_justsmash;

do $$
declare t text;
begin
  foreach t in array array[
    'diners','reservations','restaurant_tables','temp_reservation','waitlist',
    'menu_items','orders','events','feedback','chat_sessions','chat_messages',
    'message_full','messages_buffer','suggested_faqs','flow_executions',
    'notifications','couriers','routing_failures','pending_message_queue'
  ] loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = t) then
      execute format('alter table public.%I set schema r_justsmash', t);
    end if;
  end loop;
end $$;

grant usage on schema r_justsmash to anon, authenticated, service_role;
grant all privileges on all tables    in schema r_justsmash to service_role;
grant all privileges on all sequences in schema r_justsmash to service_role;
alter default privileges in schema r_justsmash grant all on tables    to service_role;
alter default privileges in schema r_justsmash grant all on sequences to service_role;

-- keep the same posture as migration 015
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'r_justsmash' loop
    execute format('alter table r_justsmash.%I enable row level security', t);
    execute format('revoke all on r_justsmash.%I from anon, authenticated', t);
  end loop;
end $$;

alter role authenticator set pgrst.db_schemas = 'public, graphql_public, r_justsmash, r_luciz';
notify pgrst, 'reload config';
