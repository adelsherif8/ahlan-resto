-- ============================================================================
-- 037: exact per-model and per-step costs. TENANT DB (r_justsmash + r_luciz).
-- Additive; re-runnable.
--
-- WHY
-- ---
-- Every other figure in the ops console is now exact (033 + 035), but per-model and
-- per-step numbers were still estimated from the 400 most recent runs per restaurant,
-- because they need the `nodes` payload and reading that in bulk over the wire is
-- exactly the egress we were trying to avoid. The console had to show model *shares*
-- rather than amounts, since a 3% sample summed to $0.16 against a real $38 and read
-- like a bug.
--
-- Expanding jsonb is cheap when Postgres does it in place. These two functions unnest
-- `nodes` server-side and return one row per model / per step, so the console can show
-- real money with no sampling caveat.
--
-- Node cost is counted exactly once here — a node belongs to exactly one execution, so
-- unlike summing flow_executions.cost_usd this cannot double count nested flows (035).
--
-- Reviewed against supabase-postgres-best-practices: stable + security invoker, explicit
-- search_path, execute to service_role, generous statement_timeout (these scan a
-- started_at range and expand jsonb; they sit behind the ops 45-60s cache and never run
-- on a guest's request). No new index — started_at is already indexed (003/031).
-- ============================================================================

do $outer$
declare
  s text;
begin
  foreach s in array array['r_justsmash', 'r_luciz']
  loop
    -- ---- per model ----
    execute format($f$
      create or replace function %1$I.ops_model_stats(p_since timestamptz)
      returns table (
        model text, calls bigint, tokens_in bigint, tokens_out bigint,
        tokens_cached bigint, cost_usd numeric, avg_ms integer, p95_ms integer
      )
      language sql stable security invoker
      set search_path = %1$I, pg_temp
      set statement_timeout = '25s'
      as $body$
        select
          el->>'model',
          count(*),
          coalesce(sum((el->>'tokens_in')::bigint), 0),
          coalesce(sum((el->>'tokens_out')::bigint), 0),
          coalesce(sum((el->>'tokens_cached')::bigint), 0),
          coalesce(sum((el->>'cost_usd')::numeric), 0)::numeric,
          coalesce(avg((el->>'ms')::numeric), 0)::integer,
          coalesce(percentile_cont(0.95) within group (order by (el->>'ms')::numeric), 0)::integer
        from flow_executions fe,
             jsonb_array_elements(coalesce(fe.nodes, '[]'::jsonb)) el
        where fe.started_at >= p_since
          and el->>'model' is not null
        group by 1
        order by 6 desc
      $body$;
    $f$, s);

    -- ---- per step (flow › node) ----
    execute format($f$
      create or replace function %1$I.ops_step_stats(p_since timestamptz)
      returns table (
        flow text, node text, calls bigint, errors bigint,
        cost_usd numeric, avg_ms integer, p95_ms integer
      )
      language sql stable security invoker
      set search_path = %1$I, pg_temp
      set statement_timeout = '25s'
      as $body$
        select
          fe.flow,
          el->>'name',
          count(*),
          count(*) filter (where el->>'status' = 'error' or el->>'error' is not null),
          coalesce(sum((el->>'cost_usd')::numeric), 0)::numeric,
          coalesce(avg((el->>'ms')::numeric), 0)::integer,
          coalesce(percentile_cont(0.95) within group (order by (el->>'ms')::numeric), 0)::integer
        from flow_executions fe,
             jsonb_array_elements(coalesce(fe.nodes, '[]'::jsonb)) el
        where fe.started_at >= p_since
          and el->>'name' is not null
        group by 1, 2
        order by 6 desc
      $body$;
    $f$, s);

    execute format('grant execute on function %1$I.ops_model_stats(timestamptz) to service_role', s);
    execute format('grant execute on function %1$I.ops_step_stats(timestamptz)  to service_role', s);
  end loop;
end
$outer$;

-- verify: these should now add up to the same total as ops_rollup_totals
-- select sum(cost_usd) from r_luciz.ops_model_stats(now() - interval '7 days');
-- select cost_usd     from r_luciz.ops_rollup_totals(now() - interval '7 days');
--   (model total <= rollup total: nodes with no model still cost nothing)
