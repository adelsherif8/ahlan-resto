-- ============================================================================
-- 040: store each run's OWN cost on the row. TENANT DB (r_justsmash + r_luciz).
-- Run the whole file; the backfill is idempotent and re-runnable.
--
-- WHY
-- ---
-- Migration 035 fixed the 3x double count by summing each row's own `nodes[]` instead of
-- `cost_usd` (which includes every sub-flow). Correct — but it means expanding jsonb for
-- every row on every read, and that does not scale:
--
--     ops_rollup_days over 14 days on r_justsmash (~40k rows) ...... 12.2s
--     ops_step_stats  over 14 days ................................. 5.7s
--     ops_rollup_totals over 14 days ............................... TIMED OUT
--
-- The timeout took the whole exact path down and the Cost page silently showed the capped
-- $13 instead of $27. Raising timeouts (036) treats the symptom.
--
-- A run's own cost never changes after it finishes, so compute it ONCE when the row is
-- written and store it. Reads become `sum(own_cost_usd)` — a plain aggregate over an
-- indexed range, no jsonb, no double counting possible by construction.
--
-- Reviewed against supabase-postgres-best-practices:
--   • ADD COLUMN with no default → metadata-only, no table rewrite (schema-constraints)
--   • numeric for money, bigint for tokens (schema-data-types)
--   • the backfill is batched so it never holds a long transaction on a table the bot is
--     writing to (lock-short-transactions)
--   • no new index: every query already filters on started_at, which is indexed (003/031)
-- ============================================================================

-- ── 1. columns ───────────────────────────────────────────────────────────────
do $outer$
declare s text;
begin
  foreach s in array array['r_justsmash', 'r_luciz']
  loop
    execute format('alter table %1$I.flow_executions add column if not exists own_cost_usd  numeric(12,6)', s);
    execute format('alter table %1$I.flow_executions add column if not exists own_tokens_in  bigint', s);
    execute format('alter table %1$I.flow_executions add column if not exists own_tokens_out bigint', s);
    execute format($c$comment on column %1$I.flow_executions.own_cost_usd is
      'Cost of THIS run''s own steps only, excluding sub-flows. cost_usd includes children (engine/flow.js rolls them up), so summing cost_usd across rows triple counts. Always aggregate own_cost_usd. Written by persistExecution; backfilled by migration 040.'$c$, s);
  end loop;
end $outer$;

-- ── 2. backfill, in batches ──────────────────────────────────────────────────
-- Each pass fills up to 5,000 rows. Re-run this block until it reports 0.
do $outer$
declare
  s text;
  n integer;
  total integer := 0;
begin
  foreach s in array array['r_justsmash', 'r_luciz']
  loop
    loop
      execute format($u$
        with batch as (
          select id from %1$I.flow_executions
           where own_cost_usd is null
           limit 5000
        ), sums as (
          select b.id,
                 coalesce(sum((el->>'cost_usd')::numeric), 0)   as c,
                 coalesce(sum((el->>'tokens_in')::bigint), 0)   as ti,
                 coalesce(sum((el->>'tokens_out')::bigint), 0)  as tout
            from batch b
            join %1$I.flow_executions fe on fe.id = b.id
            left join lateral jsonb_array_elements(coalesce(fe.nodes, '[]'::jsonb)) el on true
           group by b.id
        )
        update %1$I.flow_executions fe
           set own_cost_usd = sums.c, own_tokens_in = sums.ti, own_tokens_out = sums.tout
          from sums where fe.id = sums.id
      $u$, s);
      get diagnostics n = row_count;
      total := total + n;
      exit when n = 0;
      raise notice '% : backfilled % rows (running total %)', s, n, total;
    end loop;
  end loop;
  raise notice 'backfill complete: % rows', total;
end $outer$;

-- ── 3. point the aggregates at the column ────────────────────────────────────
do $outer$
declare s text;
begin
  foreach s in array array['r_justsmash', 'r_luciz']
  loop
    execute format($f$
      create or replace function %1$I.ops_agg_version() returns integer
      language sql immutable security invoker set search_path = %1$I, pg_temp
      as $body$ select 3 $body$;
    $f$, s);

    execute format($f$
      create or replace function %1$I.ops_rollup_days(p_since timestamptz)
      returns table (day date, runs bigint, errors bigint, sessions bigint,
                     cost_usd numeric, tokens_in bigint, tokens_out bigint,
                     avg_ms integer, p95_ms integer)
      language sql stable security invoker
      set search_path = %1$I, pg_temp set statement_timeout = '25s'
      as $body$
        select started_at::date, count(*), count(*) filter (where status = 'error'),
               count(distinct session_id),
               coalesce(sum(own_cost_usd), 0)::numeric,
               coalesce(sum(own_tokens_in), 0)::bigint,
               coalesce(sum(own_tokens_out), 0)::bigint,
               coalesce(avg(duration_ms), 0)::integer,
               coalesce(percentile_cont(0.95) within group (order by duration_ms), 0)::integer
          from flow_executions where started_at >= p_since
         group by 1 order by 1 desc
      $body$;
    $f$, s);

    execute format($f$
      create or replace function %1$I.ops_rollup_flows(p_since timestamptz)
      returns table (flow text, runs bigint, errors bigint, sessions bigint,
                     cost_usd numeric, tokens_in bigint, tokens_out bigint,
                     avg_ms integer, p95_ms integer, last_at timestamptz)
      language sql stable security invoker
      set search_path = %1$I, pg_temp set statement_timeout = '25s'
      as $body$
        select flow, count(*), count(*) filter (where status = 'error'),
               count(distinct session_id),
               coalesce(sum(own_cost_usd), 0)::numeric,
               coalesce(sum(own_tokens_in), 0)::bigint,
               coalesce(sum(own_tokens_out), 0)::bigint,
               coalesce(avg(duration_ms), 0)::integer,
               coalesce(percentile_cont(0.95) within group (order by duration_ms), 0)::integer,
               max(started_at)
          from flow_executions where started_at >= p_since
         group by flow order by 5 desc
      $body$;
    $f$, s);

    execute format($f$
      create or replace function %1$I.ops_rollup_totals(p_since timestamptz)
      returns table (runs bigint, errors bigint, sessions bigint,
                     cost_usd numeric, tokens_in bigint, tokens_out bigint,
                     avg_ms integer, p95_ms integer)
      language sql stable security invoker
      set search_path = %1$I, pg_temp set statement_timeout = '25s'
      as $body$
        select count(*), count(*) filter (where status = 'error'),
               count(distinct session_id),
               coalesce(sum(own_cost_usd), 0)::numeric,
               coalesce(sum(own_tokens_in), 0)::bigint,
               coalesce(sum(own_tokens_out), 0)::bigint,
               coalesce(avg(duration_ms), 0)::integer,
               coalesce(percentile_cont(0.95) within group (order by duration_ms), 0)::integer
          from flow_executions where started_at >= p_since
      $body$;
    $f$, s);

    execute format($f$
      create or replace function %1$I.ops_spend_split(p_since timestamptz)
      returns table (cost_total numeric, cost_guest numeric, cost_regression numeric, cost_web numeric,
                     runs_total bigint, runs_guest bigint, runs_regression bigint, runs_web bigint,
                     sessions_guest bigint)
      language sql stable security invoker
      set search_path = %1$I, pg_temp set statement_timeout = '25s'
      as $body$
        with tagged as (
          select session_id, coalesce(own_cost_usd, 0) as cost,
                 case when session_id ilike '%%regress%%' then 'regression'
                      when session_id like 'web:%%'       then 'web'
                      else 'guest' end as bucket
            from flow_executions where started_at >= p_since
        )
        select coalesce(sum(cost), 0)::numeric,
               coalesce(sum(cost) filter (where bucket = 'guest'), 0)::numeric,
               coalesce(sum(cost) filter (where bucket = 'regression'), 0)::numeric,
               coalesce(sum(cost) filter (where bucket = 'web'), 0)::numeric,
               count(*), count(*) filter (where bucket = 'guest'),
               count(*) filter (where bucket = 'regression'),
               count(*) filter (where bucket = 'web'),
               count(distinct session_id) filter (where bucket = 'guest')
          from tagged
      $body$;
    $f$, s);
  end loop;
end $outer$;

-- verify: should match what 035 reported, but in a fraction of the time
-- select cost_usd from r_justsmash.ops_rollup_totals(now() - interval '14 days');
-- select count(*) from r_justsmash.flow_executions where own_cost_usd is null;  -- expect 0
