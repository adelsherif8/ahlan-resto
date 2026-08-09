-- FB14 Reviews/Complaints tab — add the handling-workflow columns to feedback.
-- Run in the tenant DB (sxthftiqvaojbdyjizjr) SQL editor. The code is schema-tolerant
-- until this runs: reviews still capture (sentiment/rating/text), the new fields just
-- stay null and the tab shows everything as "new".
--
-- NOTE: after migration 024 the live tables live in the per-restaurant schemas
-- (r_luciz, r_justsmash) — there is NO public.feedback in the tenant DB, so this only
-- touches those two schemas.
--
-- feedback already has: id, phone_number, reservation_id, rating, food/service/vibe_rating,
-- comments, sentiment, escalated, created_at. This adds the workflow + provenance.

alter table if exists r_luciz.feedback    add column if not exists order_code      text;
alter table if exists r_luciz.feedback    add column if not exists source          text;          -- whatsapp | google-prompt | manual
alter table if exists r_luciz.feedback    add column if not exists status          text default 'new';   -- new | handling | resolved
alter table if exists r_luciz.feedback    add column if not exists assigned_to     text;
alter table if exists r_luciz.feedback    add column if not exists resolution_note text;
alter table if exists r_luciz.feedback    add column if not exists resolved_at     timestamptz;

alter table if exists r_justsmash.feedback add column if not exists order_code      text;
alter table if exists r_justsmash.feedback add column if not exists source          text;
alter table if exists r_justsmash.feedback add column if not exists status          text default 'new';
alter table if exists r_justsmash.feedback add column if not exists assigned_to     text;
alter table if exists r_justsmash.feedback add column if not exists resolution_note text;
alter table if exists r_justsmash.feedback add column if not exists resolved_at     timestamptz;

-- fast "unhandled bad reviews" lookups for the tab + the Overview warning
create index if not exists idx_feedback_status_l on r_luciz.feedback(status, created_at desc);
create index if not exists idx_feedback_status_j on r_justsmash.feedback(status, created_at desc);
