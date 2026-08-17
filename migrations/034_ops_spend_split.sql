-- ============================================================================
-- 034: separate "what it cost to serve guests" from "what our own testing cost".
-- TENANT DB (schemas r_justsmash + r_luciz). Additive — 033 stays as it is.
--
-- Why this exists: ops_rollup_totals sums every run, and on the pilot tenant that is
-- overwhelmingly US. August to date: $78.81 total, of which $74.35 was the 113-case
-- regression suite and $0.07 was real phone numbers. Charging that against the
-- restaurant's plan revenue produced a margin figure that described our R&D spend,
-- not the business.
--
-- The split is by session id, which is the only marker that exists:
--   regression  session_id ilike '%regress%'   (runRegression names its sessions)
--   web/test    session_id like 'web:%'        (ops Test Chat, preview widgets)
--   guest       anything else                  (WhatsApp sessions ARE the phone number)
--
-- If the web channel is ever exposed to real guests, `web` stops meaning "test" and
-- this rule needs revisiting — hence three buckets rather than a boolean.
--
-- Reviewed against supabase-postgres-best-practices: stable + security invoker, explicit
-- search_path, execute granted to service_role only, no new index (started_at is
-- already indexed by 003/031 and the filter is a scan of that range either way).
-- ============================================================================

do $outer$
declare
  s text;
begin
  foreach s in array array['r_justsmash', 'r_luciz']
  loop
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
            cost_usd,
            session_id,
            case
              when session_id ilike '%%regress%%' then 'regression'
              when session_id like 'web:%%'       then 'web'
              else 'guest'
            end as bucket
          from flow_executions
          where started_at >= p_since
        )
        select
          coalesce(sum(cost_usd), 0)::numeric,
          coalesce(sum(cost_usd) filter (where bucket = 'guest'), 0)::numeric,
          coalesce(sum(cost_usd) filter (where bucket = 'regression'), 0)::numeric,
          coalesce(sum(cost_usd) filter (where bucket = 'web'), 0)::numeric,
          count(*),
          count(*) filter (where bucket = 'guest'),
          count(*) filter (where bucket = 'regression'),
          count(*) filter (where bucket = 'web'),
          count(distinct session_id) filter (where bucket = 'guest')
        from tagged
      $body$;
    $f$, s);

    execute format('grant execute on function %1$I.ops_spend_split(timestamptz) to service_role', s);
  end loop;
end
$outer$;

-- verify
-- select * from r_justsmash.ops_spend_split(date_trunc('month', now()));
--   expect cost_regression to dominate on the pilot, cost_guest to be tiny
