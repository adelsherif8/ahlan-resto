-- ============================================================================
-- 033: let Postgres do the arithmetic, and remember when the service restarted.
--
-- TWO PARTS, TWO DATABASES:
--   PART A -> CONTROL DB (npznnysudtkesnliibvl): service_boots
--   PART B -> the TENANT DB (schemas r_justsmash + r_luciz): aggregate functions
--
-- Why part B exists: the ops rollup read up to 20,000 execution rows over the wire to
-- produce a dozen sums, and the plans endpoint read every order row to total them.
-- PostgREST cannot express GROUP BY, so the aggregation happened in Node — paying
-- egress (the thing Supabase actually bills) for rows nobody looks at. These functions
-- return one row per bucket instead. The endpoints fall back to the old path when the
-- functions are absent, so running this is an optimisation, never a requirement.
--
-- Reviewed against supabase-postgres-best-practices:
--   • `stable` + `security invoker`, and an explicit `search_path` on every function,
--     so nothing resolves through a caller-controlled path (security-privileges);
--   • `execute` granted to service_role only — flows is the sole caller, and these read
--     the whole trace table (no anon/authenticated grant);
--   • timestamptz throughout, numeric for money (schema-data-types);
--   • no new index: every function filters on started_at/created_at, both already
--     indexed (003 + 031). Verify with EXPLAIN before adding any.
-- ============================================================================


-- ════════════════════════════ PART A — CONTROL DB ════════════════════════════
-- Run this section in the CONTROL project (npznnysudtkesnliibvl).
--
-- `railway up` deploys from a working directory and carries no git metadata, so there
-- is no record anywhere of when behaviour changed. One row per boot makes "did my
-- change break it" answerable by looking instead of guessing.

create table if not exists service_boots (
  id          bigint generated always as identity primary key,
  service     text not null,                       -- 'flows'
  started_at  timestamptz not null default now(),
  env         text,                                -- 'production' | 'local' | …
  note        text
);

create index if not exists service_boots_started_idx on service_boots (service, started_at desc);

comment on table service_boots is
  'One row each time a service process starts. Used by the ops console to mark "deployed here" on its charts. Written by flows on boot; nothing reads it in the request path.';


-- ═════════════════════════ PART B — TENANT DB (per schema) ═══════════════════
-- Run this section in the TENANT project (sxthftiqvaojbdyjizjr). The loop creates the
-- same functions in every restaurant schema, so adding a restaurant means adding one
-- name to the array and re-running.

do $outer$
declare
  s text;
begin
  foreach s in array array['r_justsmash', 'r_luciz']
  loop
    -- ---- executions bucketed by day -------------------------------------------------
    execute format($f$
      create or replace function %1$I.ops_rollup_days(p_since timestamptz)
      returns table (
        day date, runs bigint, errors bigint, sessions bigint,
        cost_usd numeric, tokens_in bigint, tokens_out bigint,
        avg_ms integer, p95_ms integer
      )
      language sql stable security invoker
      set search_path = %1$I, pg_temp
      as $body$
        select
          started_at::date                                             as day,
          count(*)                                                     as runs,
          count(*) filter (where status = 'error')                     as errors,
          count(distinct session_id)                                   as sessions,
          coalesce(sum(cost_usd), 0)::numeric                          as cost_usd,
          coalesce(sum(tokens_in), 0)::bigint                          as tokens_in,
          coalesce(sum(tokens_out), 0)::bigint                         as tokens_out,
          coalesce(avg(duration_ms), 0)::integer                       as avg_ms,
          coalesce(percentile_cont(0.95) within group (order by duration_ms), 0)::integer as p95_ms
        from flow_executions
        where started_at >= p_since
        group by 1
        order by 1 desc
      $body$;
    $f$, s);

    -- ---- executions bucketed by flow ------------------------------------------------
    execute format($f$
      create or replace function %1$I.ops_rollup_flows(p_since timestamptz)
      returns table (
        flow text, runs bigint, errors bigint, sessions bigint,
        cost_usd numeric, tokens_in bigint, tokens_out bigint,
        avg_ms integer, p95_ms integer, last_at timestamptz
      )
      language sql stable security invoker
      set search_path = %1$I, pg_temp
      as $body$
        select
          flow,
          count(*), count(*) filter (where status = 'error'), count(distinct session_id),
          coalesce(sum(cost_usd), 0)::numeric,
          coalesce(sum(tokens_in), 0)::bigint, coalesce(sum(tokens_out), 0)::bigint,
          coalesce(avg(duration_ms), 0)::integer,
          coalesce(percentile_cont(0.95) within group (order by duration_ms), 0)::integer,
          max(started_at)
        from flow_executions
        where started_at >= p_since
        group by flow
        order by 5 desc
      $body$;
    $f$, s);

    -- ---- one totals row -------------------------------------------------------------
    execute format($f$
      create or replace function %1$I.ops_rollup_totals(p_since timestamptz)
      returns table (
        runs bigint, errors bigint, sessions bigint,
        cost_usd numeric, tokens_in bigint, tokens_out bigint,
        avg_ms integer, p95_ms integer
      )
      language sql stable security invoker
      set search_path = %1$I, pg_temp
      as $body$
        select
          count(*), count(*) filter (where status = 'error'), count(distinct session_id),
          coalesce(sum(cost_usd), 0)::numeric,
          coalesce(sum(tokens_in), 0)::bigint, coalesce(sum(tokens_out), 0)::bigint,
          coalesce(avg(duration_ms), 0)::integer,
          coalesce(percentile_cont(0.95) within group (order by duration_ms), 0)::integer
        from flow_executions
        where started_at >= p_since
      $body$;
    $f$, s);

    -- ---- orders: billable count and value in one row --------------------------------
    -- cancelled is excluded from BOTH count and value, so a caller cannot pair a
    -- billable count with an all-orders total and call the ratio an average order.
    execute format($f$
      create or replace function %1$I.ops_order_stats(p_since timestamptz)
      returns table (
        orders_all bigint, orders_billable bigint, cancelled bigint,
        value_all numeric, value_billable numeric, aov numeric
      )
      language sql stable security invoker
      set search_path = %1$I, pg_temp
      as $body$
        select
          count(*),
          count(*) filter (where status <> 'cancelled'),
          count(*) filter (where status = 'cancelled'),
          coalesce(sum(total), 0)::numeric,
          coalesce(sum(total) filter (where status <> 'cancelled'), 0)::numeric,
          coalesce(
            sum(total) filter (where status <> 'cancelled')
            / nullif(count(*) filter (where status <> 'cancelled'), 0), 0)::numeric
        from orders
        where created_at >= p_since
      $body$;
    $f$, s);

    execute format('grant execute on function %1$I.ops_rollup_days(timestamptz)   to service_role', s);
    execute format('grant execute on function %1$I.ops_rollup_flows(timestamptz)  to service_role', s);
    execute format('grant execute on function %1$I.ops_rollup_totals(timestamptz) to service_role', s);
    execute format('grant execute on function %1$I.ops_order_stats(timestamptz)   to service_role', s);
  end loop;
end
$outer$;

-- verify (tenant DB)
-- select * from r_luciz.ops_rollup_days(now() - interval '7 days');
-- select * from r_luciz.ops_order_stats(date_trunc('month', now()));
-- verify (control DB)
-- select service, started_at, env from service_boots order by started_at desc limit 10;
