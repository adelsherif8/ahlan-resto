-- Run in the RESTAURANT tenant project (sxthftiqvaojbdyjizjr) SQL editor.
-- Smart greetings: the WhatsApp profile name (soft, unconfirmed) and a chat-level
-- last-seen stamp (last_visit_at stays reserved for physical visits).

alter table diners add column if not exists wa_profile_name text;
alter table diners add column if not exists last_seen_at timestamptz;
