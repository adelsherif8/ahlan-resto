-- ============================================================================
-- 039: keep cost history after the traces are deleted. CONTROL DB (npznnysudtkesnliibvl).
--
-- WHY THIS HAS TO EXIST
-- ---------------------
-- The janitor purges flow_executions after 14 days (errors after 30), which is correct —
-- nobody debugs a three-week-old trace, and the table grows by ~40k rows a fortnight.
-- But it means the only source of cost data forgets the past. Asked for August on the
-- 17th, the console could only see the 3rd onward and reported $26.68 against a real
-- OpenAI bill of $33.57. Asked for July, it would report ~nothing at all.
--
-- One row per restaurant per day, written while the traces still exist. Small (a few
-- hundred rows a year per restaurant), permanent, and it makes "July vs August"
-- answerable — from the day it starts running, not retroactively.
--
-- Lives in the CONTROL plane, not the tenant DBs: it is our accounting, it must survive
-- a tenant schema being restored or handed over, and "spend per month across all
-- restaurants" should be one query rather than one per tenant.
--
-- Reviewed against supabase-postgres-best-practices:
--   • numeric for money, bigint for token counts, `date` for the bucket (schema-data-types)
--   • natural composite primary key (restaurant, day) — the upsert target, and it makes
--     re-running a snapshot idempotent rather than duplicating a day (schema-primary-keys)
--   • one index on (day) for the cross-restaurant month queries; the PK already covers
--     per-restaurant lookups, so no redundant index (query-composite-indexes)
--   • no RLS: control-plane table, service_role only, never exposed to a browser
-- ============================================================================

create table if not exists cost_daily (
  restaurant       text        not null,
  day              date        not null,
  runs             integer     not null default 0,
  errors           integer     not null default 0,
  sessions         integer     not null default 0,
  cost_usd         numeric(12,6) not null default 0,
  cost_guest_usd   numeric(12,6),           -- null = not split (pre-034 snapshot)
  cost_test_usd    numeric(12,6),
  tokens_in        bigint      not null default 0,
  tokens_out       bigint      not null default 0,
  orders_billable  integer,
  order_value_egp  numeric(12,2),
  snapshot_at      timestamptz not null default now(),
  primary key (restaurant, day)
);

create index if not exists cost_daily_day_idx on cost_daily (day desc);

comment on table cost_daily is
  'Daily cost/usage per restaurant, snapshotted from flow_executions BEFORE the janitor purges it (14d). The only source of month-over-month history. Written hourly by flows; re-running a snapshot upserts, never duplicates. Figures are node-level (see migration 035) so nested sub-flows are not double counted.';
comment on column cost_daily.cost_usd is
  'Node-level model spend for that day. Still a floor for days that were already partly purged when first snapshotted — compare against the provider bill.';

-- verify
-- select day, sum(cost_usd) from cost_daily group by day order by day desc limit 20;
-- select to_char(day,'YYYY-MM') as month, sum(cost_usd), sum(orders_billable)
--   from cost_daily group by 1 order by 1 desc;
