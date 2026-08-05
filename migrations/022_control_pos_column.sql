-- 022: POS/commerce settings section for the control plane.
-- !! RUN THIS ON THE **CONTROL PLANE** DB (npznnysudtkesnliibvl), not the tenant DB.
-- Every Settings → POS field (cashiers + PINs, stations, promos, loyalty rule,
-- branch-switch PIN, order-code format, guest-screen WhatsApp number) lives here.
-- Without it, saving that section 500s and the bot can't read loyalty/promos.
alter table restaurants add column if not exists pos jsonb not null default '{}'::jsonb;
