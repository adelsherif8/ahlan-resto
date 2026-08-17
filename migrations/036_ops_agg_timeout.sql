-- ============================================================================
-- 036: give the ops aggregates room to finish. TENANT DB (r_justsmash + r_luciz).
-- Re-runnable; changes only the functions' statement_timeout.
--
-- WHY
-- ---
-- ops_rollup_totals(month) was cancelled at 8.5s by Supabase's default 8s
-- statement_timeout on the busy schema (41,614 rows in one group). Its grouped
-- siblings were fine — ops_rollup_days 1.9s, ops_rollup_flows 1.6s, ops_spend_split
-- 3.2s — because the expensive parts of the *totals* query are the ones that cannot
-- be grouped: a single `percentile_cont(0.95) within group (order by duration_ms)`
-- sorts every row, and `count(distinct session_id)` builds one hash over all of them.
--
-- 25s is generous but harmless: these are ops reads, called behind a 60-second cache,
-- never on the path of a guest's message. A timeout mid-report is worse than a slow
-- report, because the caller then has to fall back to reading tens of thousands of
-- rows over the wire to answer the same question.
--
-- The real load reduction is in the caller, not here: /api/ops/insights no longer asks
-- for month-window totals at all — it takes MTD cost from ops_spend_split, which it was
-- already calling, and which returns in a third of the time.
-- ============================================================================

do $outer$
declare
  s text;
begin
  foreach s in array array['r_justsmash', 'r_luciz']
  loop
    execute format('alter function %1$I.ops_rollup_totals(timestamptz) set statement_timeout = ''25s''', s);
    execute format('alter function %1$I.ops_rollup_days(timestamptz)   set statement_timeout = ''25s''', s);
    execute format('alter function %1$I.ops_rollup_flows(timestamptz)  set statement_timeout = ''25s''', s);
    execute format('alter function %1$I.ops_spend_split(timestamptz)   set statement_timeout = ''25s''', s);
    execute format('alter function %1$I.ops_order_stats(timestamptz)   set statement_timeout = ''25s''', s);
  end loop;
end
$outer$;

-- verify: this timed out before, and should now return a row
-- select runs, cost_usd from r_justsmash.ops_rollup_totals(date_trunc('month', now()));
