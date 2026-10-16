-- 043: DEMO LEADS — only for the Munadim demo tenant (r_munadim).
-- !! RUN ON THE **TENANT** DB (sxthftiqvaojbdyjizjr).
--
-- Munadim is our own showcase restaurant: the people who message that number are
-- restaurant owners trying the product, not guests ordering dinner. This table holds
-- who they are and when their 24-hour trial ends. No real client tenant gets this
-- table, and nothing here touches orders, diners or any restaurant's data.
create table if not exists r_munadim.demo_leads (
  id            uuid primary key default gen_random_uuid(),
  phone_number  text not null unique,
  name          text,
  business_name text,
  business_type text,                       -- burgers / coffee / bakery / cloud kitchen…
  website       text,                       -- site or instagram
  city          text,
  branches      text,
  note          text,
  source        text default 'whatsapp',
  started_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '24 hours',
  submitted_at  timestamptz,                -- when the form came back
  prompted_at   timestamptz,                -- when we last sent the form link
  created_at    timestamptz not null default now()
);
create index if not exists demo_leads_phone_idx   on r_munadim.demo_leads (phone_number);
create index if not exists demo_leads_expires_idx on r_munadim.demo_leads (expires_at desc);

grant all privileges on r_munadim.demo_leads to service_role;
alter table r_munadim.demo_leads enable row level security;
revoke all on r_munadim.demo_leads from anon, authenticated;

select 'demo_leads ready' as status;
