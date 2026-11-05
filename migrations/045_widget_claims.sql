-- 045: dine-in widget TABLE CLAIMS (docs/KOFFEE-KULTURE-DINE-IN.md §2).
-- !! RUN ON THE **TENANT** DB (sxthftiqvaojbdyjizjr). One row per table = the visit that owns it.
-- First phone to scan owns the table; table-mates join with the 4-digit code; "that's not my
-- table" releases + flags it. A claim ends 90 min after the last activity/order, or when every
-- order on it is paid/closed. Safe to re-run.
do $$
declare s text;
begin
  foreach s in array array['r_koffee','r_luciz','r_munadim'] loop
    if to_regnamespace(s) is null then continue; end if;
    execute format($f$
      create table if not exists %I.widget_claims (
        table_number     text primary key,
        branch           text,
        owner_session    text not null,
        members          text[] not null default '{}',
        join_code        text not null,
        claimed_at       timestamptz not null default now(),
        last_activity_at timestamptz not null default now(),
        expires_at       timestamptz not null,
        released_at      timestamptz,
        release_reason   text,
        flagged          boolean not null default false,
        disputes         int not null default 0
      )$f$, s);
    execute format('grant all on %I.widget_claims to service_role', s);
    execute format('alter table %I.widget_claims enable row level security', s);
    execute format('revoke all on %I.widget_claims from anon, authenticated', s);
  end loop;
end $$;
notify pgrst, 'reload schema';
select table_schema, table_name from information_schema.tables where table_name = 'widget_claims' order by 1;
