-- flow_executions is the debug trace table and grows fast. The hourly janitor purge
-- deletes old rows in batches, but with no index every batch scanned the whole table:
-- observed runs of 29 and 42 MINUTES, pinning the tenant DB while guests waited.
create index concurrently if not exists flow_executions_started_at_idx
  on r_luciz.flow_executions (started_at);
create index concurrently if not exists flow_executions_started_at_idx
  on r_justsmash.flow_executions (started_at);
