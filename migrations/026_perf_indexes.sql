-- 026 PERF — indexes on the hot-path columns we filter by every single turn.
-- Run in the tenant DB (sxthftiqvaojbdyjizjr) SQL editor. Idempotent + zero-risk
-- (create index if not exists). Biggest single latency win: the two hottest tables
-- (message_full, diners) are read AND written on every message and had NO index on
-- phone_number, so every access was a sequential scan (300–800ms). With these they
-- drop to ~a few ms.
--
-- After migration 024 the live tables are in the per-restaurant schemas (r_luciz,
-- r_justsmash) — there is no public.* copy in the tenant DB, so we only touch those two.

-- history blob: read + rewritten every turn, keyed by phone_number
create index if not exists idx_message_full_phone_l on r_luciz.message_full(phone_number);
create index if not exists idx_message_full_phone_j on r_justsmash.message_full(phone_number);

-- diner: upserted/read ~3× per turn (diner_upsert, precheck, gates), keyed by phone_number
create index if not exists idx_diners_phone_l on r_luciz.diners(phone_number);
create index if not exists idx_diners_phone_j on r_justsmash.diners(phone_number);

-- order history / "where's my order" / builder popular-list: filter by phone, sort by recency
create index if not exists idx_orders_phone_l on r_luciz.orders(phone_number, created_at desc);
create index if not exists idx_orders_phone_j on r_justsmash.orders(phone_number, created_at desc);
-- builder "most popular" pulls the latest orders regardless of phone
create index if not exists idx_orders_created_l on r_luciz.orders(created_at desc);
create index if not exists idx_orders_created_j on r_justsmash.orders(created_at desc);

-- buffer claim: every turn reads/claims the burst by phone_number
create index if not exists idx_msgbuf_phone_l on r_luciz.messages_buffer(phone_number);
create index if not exists idx_msgbuf_phone_j on r_justsmash.messages_buffer(phone_number);

-- failed-send retry drain: by phone + when it's next due
create index if not exists idx_pendq_phone_l on r_luciz.pending_message_queue(phone_number, next_attempt_at);
create index if not exists idx_pendq_phone_j on r_justsmash.pending_message_queue(phone_number, next_attempt_at);

-- Verify afterwards (optional):
--   select schemaname, indexname from pg_indexes
--   where schemaname in ('r_luciz','r_justsmash') and indexname like 'idx_%phone%';
