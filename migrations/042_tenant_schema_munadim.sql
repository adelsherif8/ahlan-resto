-- 042: MUNADIM — the platform's own flagship restaurant.
-- !! RUN ON THE **TENANT** DB (sxthftiqvaojbdyjizjr), in one go.
--
-- Cloned from the LIVE r_luciz schema (public has no tenant tables since 024), so
-- every column/index added by 025–040 comes along by construction. The ops-console
-- aggregate functions (033–040) are copied from r_luciz's current definitions too.
-- Safe to re-run.

create schema if not exists r_munadim;

-- 1) tables — structure, defaults, constraints, indexes
do $$
declare t text;
begin
  foreach t in array array[
    'diners','reservations','restaurant_tables','temp_reservation','waitlist','menu_items',
    'orders','events','feedback','chat_sessions','chat_messages','message_full',
    'messages_buffer','suggested_faqs','flow_executions','notifications','couriers',
    'routing_failures','pending_message_queue'
  ] loop
    if to_regclass(format('r_luciz.%I', t)) is not null then
      execute format('create table if not exists r_munadim.%I (like r_luciz.%I including all)', t, t);
    else
      raise notice 'skipped %: not present in r_luciz', t;
    end if;
  end loop;
end $$;

-- 2) own sequences — a copied serial default would still point at r_luciz's sequence
do $$
declare c record; seq text;
begin
  for c in
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'r_munadim' and column_default like 'nextval(%r_luciz%'
  loop
    seq := format('%s_%s_seq', c.table_name, c.column_name);
    execute format('create sequence if not exists r_munadim.%I', seq);
    execute format('alter table r_munadim.%I alter column %I set default nextval(%L)', c.table_name, c.column_name, 'r_munadim.' || seq);
    execute format('alter sequence r_munadim.%I owned by r_munadim.%I.%I', seq, c.table_name, c.column_name);
  end loop;
end $$;

-- 3) ops-console functions, copied from r_luciz's current definitions
do $$
declare f record; def text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'r_luciz'
  loop
    def := replace(pg_get_functiondef(f.oid), 'r_luciz', 'r_munadim');
    execute def;
  end loop;
end $$;

-- 4) access — service key only (same posture as 015/023/033)
grant usage on schema r_munadim to anon, authenticated, service_role;
grant all privileges on all tables    in schema r_munadim to service_role;
grant all privileges on all sequences in schema r_munadim to service_role;
alter default privileges in schema r_munadim grant all on tables    to service_role;
alter default privileges in schema r_munadim grant all on sequences to service_role;
revoke execute on all functions in schema r_munadim from public, anon, authenticated;
grant  execute on all functions in schema r_munadim to service_role;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'r_munadim' loop
    execute format('alter table r_munadim.%I enable row level security', t);
    execute format('revoke all on r_munadim.%I from anon, authenticated', t);
  end loop;
end $$;

-- 5) expose the schema to the API
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, r_justsmash, r_luciz, r_munadim';
notify pgrst, 'reload config';

-- check: should list ~19 tables and the ops_* functions
select 'table' as kind, tablename as name from pg_tables where schemaname = 'r_munadim'
union all
select 'function', p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'r_munadim'
order by 1, 2;
