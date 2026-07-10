-- Ahlan control-plane DB (same Supabase project as the hotels control plane).
-- Creates the restaurants tenant directory + restaurant users.
-- Run once in the Ahlan Supabase SQL editor.

create table if not exists restaurants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,                -- public tenant slug (payment links, QR codes)
  name text not null,
  phone_number text,                        -- WhatsApp display number
  wpid text,                                -- WhatsApp phone_number_id
  basic_info jsonb not null default '{}'::jsonb,
  -- { name, address, area, city, contact{phone,email,instagram,website}, timezone, language, logo_url, dress_code, parking }
  hours jsonb not null default '{}'::jsonb,
  -- { mon:[{open:"12:00",close:"01:00"}], ... , kitchen_close_offset_min, notes }
  sections jsonb not null default '[]'::jsonb,
  -- [ { key:"indoor", name:"Indoor", tables:[{number,capacity,shape,vip}], reservable:true } ]
  menu_config jsonb not null default '{}'::jsonb,
  -- { categories:[...], currency:"EGP", service_charge, tax } (items live in tenant DB)
  reservation_policy jsonb not null default '{}'::jsonb,
  -- { slot_minutes:30, turn_minutes:{ "2":90, "4":105, "6+":120 }, max_party_online:8,
  --   deposits:{ enabled, per_person, peak_only, peak_days:["thu","fri"], applies_from_party:4 },
  --   min_spend:{ enabled, tiers:[...] }, grace_minutes:15, waitlist_enabled:true,
  --   drop:{ enabled, release_dow:"mon", release_time:"18:00", horizon_days:7, vip_early_minutes:60 } }
  payments jsonb not null default '{}'::jsonb,
  -- { currency:"EGP", tax, service_charge, paymob_enabled, methods:[...] }
  ai jsonb not null default '{}'::jsonb,
  -- { name, personality, chat_enabled, greeting, off_hours{enabled,start,end,reply},
  --   reservations_enabled, orders_enabled, response_delay_ms }
  faqs jsonb not null default '[]'::jsonb,
  integrations jsonb not null default '{}'::jsonb,
  -- { supabase:{url,key}  <- AES-256-GCM encrypted like hotels,
  --   whatsapp:{phone_number_id,waba_id,access_token}, paymob:{...}, instagram:{...} }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Restaurant staff accounts (mirrors the hotel control-plane users table shape; separate table keeps verticals independent)
create table if not exists restaurant_users (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  email text unique not null,
  password_hash text not null,
  name text,
  role text not null default 'host',  -- admin | manager | host | kitchen | livechat
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_restaurant_users_restaurant on restaurant_users(restaurant_id);
