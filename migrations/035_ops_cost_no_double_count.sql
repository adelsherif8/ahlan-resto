-- ============================================================================
-- 035: stop triple-counting money. TENANT DB (r_justsmash + r_luciz).
-- Redefines the 033/034 aggregate functions in place — same names, same return
-- shapes, corrected arithmetic. Safe to re-run.
--
-- THE BUG
-- -------
-- engine/flow.js rolls a sub-flow's cost up into its parent:
--     exec.cost_usd = round6(exec.cost_usd + child.exec.cost_usd)
-- and then persists BOTH rows. So one LLM call appears in the parent's cost_usd, the
-- grandparent's, and its own row. `sum(cost_usd)` over rows therefore counts it once
-- per level of nesting. A typical turn is respond → master → friendly, so the total
-- came out ~3x too high:
--
--     ahlan-pilot, August: sum(cost_usd) over 41,614 rows   = $78.81   (wrong)
--                          sum over root rows only          = $26.17
--                          sum of node-level costs          = $26.18   (truth)
--
-- THE FIX
-- -------
-- Cost and tokens are summed from each row's OWN `nodes` array. A node is where an
-- LLM call is actually recorded, exactly once, so this cannot double count no matter
-- how deep flows nest. It also makes per-flow attribution honest: `respond` is charged
-- for respond's own nodes, not for everything master and friendly did beneath it.
--
-- Root-only summing (`where parent_id is null`) gets the same platform total and is
-- cheaper, but it attributes nothing per flow and silently loses a child whose parent
-- row has already been purged by the janitor — so nodes it is.
--
-- Durations are deliberately NOT changed: a parent's duration_ms genuinely includes
-- the time its children took, and for `respond` that nested total IS the guest-facing
-- latency. Only money and tokens were being double counted.
--
-- Reviewed against supabase-postgres-best-practices: stable + security invoker,
-- explicit search_path, execute to service_role, no new index (the jsonb expansion is
-- per-row work over an already index-filtered started_at range).
-- ============================================================================

do $outer$
declare
  s text;
begin
  foreach s in array array['r_justsmash', 'r_luciz']
  loop
    -- ---- version marker ----
    -- flows refuses to trust an RPC cost figure unless this reports >= 2, because the
    -- v1 functions from 033/034 double counted. Without it, running the console against
    -- a half-migrated schema would silently report 3x the real spend.
    execute format($f$
      create or replace function %1$I.ops_agg_version()
      returns integer
      language sql immutable security invoker
      set search_path = %1$I, pg_temp
      as $body$ select 2 $body$;
    $f$, s);
    execute format('grant execute on function %1$I.ops_agg_version() to service_role', s);

    -- ---- per day ----
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
          fe.started_at::date,
          count(*),
          count(*) filter (where fe.status = 'error'),
          count(distinct fe.session_id),
          coalesce(sum(own.cost), 0)::numeric,
          coalesce(sum(own.t_in), 0)::bigint,
          coalesce(sum(own.t_out), 0)::bigint,
          coalesce(avg(fe.duration_ms), 0)::integer,
          coalesce(percentile_cont(0.95) within group (order by fe.duration_ms), 0)::integer
        from flow_executions fe
        left join lateral (
          select
            sum((el->>'cost_usd')::numeric)  as cost,
            sum((el->>'tokens_in')::bigint)  as t_in,
            sum((el->>'tokens_out')::bigint) as t_out
          from jsonb_array_elements(coalesce(fe.nodes, '[]'::jsonb)) el
        ) own on true
        where fe.started_at >= p_since
        group by 1
        order by 1 desc
      $body$;
    $f$, s);

    -- ---- per flow ----
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
          fe.flow,
          count(*),
          count(*) filter (where fe.status = 'error'),
          count(distinct fe.session_id),
          coalesce(sum(own.cost), 0)::numeric,
          coalesce(sum(own.t_in), 0)::bigint,
          coalesce(sum(own.t_out), 0)::bigint,
          coalesce(avg(fe.duration_ms), 0)::integer,
          coalesce(percentile_cont(0.95) within group (order by fe.duration_ms), 0)::integer,
          max(fe.started_at)
        from flow_executions fe
        left join lateral (
          select
            sum((el->>'cost_usd')::numeric)  as cost,
            sum((el->>'tokens_in')::bigint)  as t_in,
            sum((el->>'tokens_out')::bigint) as t_out
          from jsonb_array_elements(coalesce(fe.nodes, '[]'::jsonb)) el
        ) own on true
        where fe.started_at >= p_since
        group by fe.flow
        order by 5 desc
      $body$;
    $f$, s);

    -- ---- totals ----
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
          count(*),
          count(*) filter (where fe.status = 'error'),
          count(distinct fe.session_id),
          coalesce(sum(own.cost), 0)::numeric,
          coalesce(sum(own.t_in), 0)::bigint,
          coalesce(sum(own.t_out), 0)::bigint,
          coalesce(avg(fe.duration_ms), 0)::integer,
          coalesce(percentile_cont(0.95) within group (order by fe.duration_ms), 0)::integer
        from flow_executions fe
        left join lateral (
          select
            sum((el->>'cost_usd')::numeric)  as cost,
            sum((el->>'tokens_in')::bigint)  as t_in,
            sum((el->>'tokens_out')::bigint) as t_out
          from jsonb_array_elements(coalesce(fe.nodes, '[]'::jsonb)) el
        ) own on true
        where fe.started_at >= p_since
      $body$;
    $f$, s);

    -- ---- guest vs our own test spend (034), same correction ----
    execute format($f$
      create or replace function %1$I.ops_spend_split(p_since timestamptz)
      returns table (
        cost_total numeric, cost_guest numeric, cost_regression numeric, cost_web numeric,
        runs_total bigint, runs_guest bigint, runs_regression bigint, runs_web bigint,
        sessions_guest bigint
      )
      language sql stable security invoker
      set search_path = %1$I, pg_temp
      as $body$
        with tagged as (
          select
            fe.session_id,
            coalesce(own.cost, 0) as cost,
            case
              when fe.session_id ilike '%%regress%%' then 'regression'
              when fe.session_id like 'web:%%'       then 'web'
              else 'guest'
            end as bucket
          from flow_executions fe
          left join lateral (
            select sum((el->>'cost_usd')::numeric) as cost
            from jsonb_array_elements(coalesce(fe.nodes, '[]'::jsonb)) el
          ) own on true
          where fe.started_at >= p_since
        )
        select
          coalesce(sum(cost), 0)::numeric,
          coalesce(sum(cost) filter (where bucket = 'guest'), 0)::numeric,
          coalesce(sum(cost) filter (where bucket = 'regression'), 0)::numeric,
          coalesce(sum(cost) filter (where bucket = 'web'), 0)::numeric,
          count(*),
          count(*) filter (where bucket = 'guest'),
          count(*) filter (where bucket = 'regression'),
          count(*) filter (where bucket = 'web'),
          count(distinct session_id) filter (where bucket = 'guest')
        from tagged
      $body$;
    $f$, s);
  end loop;
end
$outer$;

-- verify: this should now read ~$26 for August, not ~$79
-- select cost_usd from r_justsmash.ops_rollup_totals(date_trunc('month', now()));
-- and the two ways of counting should agree:
-- select
--   (select sum(cost_usd) from r_justsmash.flow_executions
--     where started_at >= date_trunc('month', now()) and parent_id is null) as roots_only,
--   (select cost_usd from r_justsmash.ops_rollup_totals(date_trunc('month', now()))) as node_level;
