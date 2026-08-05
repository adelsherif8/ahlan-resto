-- 021: WhatsApp agent automations — one-shot markers so a guest is never nudged twice.
-- Run against the TENANT database (sxthftiqvaojbdyjizjr).
alter table orders add column if not exists upsell_pinged_at timestamptz;
alter table orders add column if not exists review_prompted_at timestamptz;
