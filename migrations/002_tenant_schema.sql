-- Per-restaurant tenant DB schema (run in EACH restaurant's own Supabase project).
-- Canonical conventions: snake_case, phone column is ALWAYS phone_number.

-- ============ CRM ============
create table if not exists diners (
  id uuid primary key default gen_random_uuid(),
  phone_number text unique not null,
  wa_id text,
  name text,
  email text,
  is_vip boolean not null default false,
  visit_count int not null default 0,
  total_spend numeric not null default 0,
  last_visit_at timestamptz,
  allergies text[],
  preferences jsonb not null default '{}'::jsonb,  -- { favorite_table, favorite_items[], seating, occasions:{birthday:"03-14"} }
  tags text[],
  notes text,
  status text not null default 'lead',             -- lead | customer | regular | vip | blocked
  created_at timestamptz not null default now()
);

-- ============ FLOOR ============
create table if not exists restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  table_number text not null,
  section text not null default 'indoor',
  capacity int not null default 2,
  status text not null default 'free',   -- free | reserved | seated | bill | cleaning | blocked
  vip boolean not null default false,
  current_reservation_id uuid,
  updated_at timestamptz not null default now(),
  unique(table_number)
);

-- ============ RESERVATIONS ============
create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                       -- short human code e.g. R-4F2K
  diner_phone text not null,
  diner_name text,
  party_size int not null,
  date date not null,
  time_slot time not null,
  end_slot time,                                   -- derived from turn time
  section_pref text,
  table_id uuid references restaurant_tables(id),
  occasion text,                                   -- birthday | anniversary | business | date | none
  special_requests text,
  status text not null default 'pending',
  -- pending | awaiting_deposit | confirmed | reminded | arrived | seated | completed | no_show | cancelled
  source text not null default 'whatsapp',         -- whatsapp | instagram | walk_in | phone | dashboard
  deposit_amount numeric,
  deposit_status text,                             -- none | pending | paid | refunded | applied | forfeited
  payment_link text,
  reminder_sent_at timestamptz,
  arrived_at timestamptz,
  seated_at timestamptz,
  completed_at timestamptz,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_reservations_date on reservations(date, time_slot);
create index if not exists idx_reservations_phone on reservations(diner_phone);

-- Covers inventory per slot (the "rooms_availability" analog)
create table if not exists slot_inventory (
  id bigserial primary key,
  date date not null,
  time_slot time not null,
  section text not null,
  covers_total int not null,
  covers_held int not null default 0,
  covers_booked int not null default 0,
  unique(date, time_slot, section)
);

-- WhatsApp reservation-agent session state (the "temp_booking" analog)
create table if not exists temp_reservation (
  phone_number text primary key,
  session_status text not null default 'incomplete', -- incomplete | quoted | awaiting_confirm | awaiting_deposit | confirmed | archived
  stage text,
  party_size int,
  date date,
  time_slot time,
  section_pref text,
  occasion text,
  special_requests text,
  quoted jsonb,                                      -- last availability/deposit quote shown
  turns_in_stage int not null default 0,
  turns_in_session int not null default 0,
  recovery_attempts int not null default 0,
  handoff_context text,
  updated_at timestamptz not null default now()
);

-- ============ WAITLIST ============
create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null,
  name text,
  party_size int not null,
  quoted_wait_min int,
  status text not null default 'waiting',  -- waiting | notified | seated | left | expired
  position int,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============ MENU & ORDERS ============
create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  price numeric not null,
  description text,
  dietary_tags text[],                     -- vegan | vegetarian | gf | nuts | dairy | spicy
  available boolean not null default true, -- the 86 toggle
  available_from time,
  available_to time,
  photo_url text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  phone_number text,
  diner_name text,
  order_type text not null default 'dine_in', -- dine_in | pre_order | pickup | delivery | table_reorder
  table_number text,
  reservation_id uuid references reservations(id),
  items jsonb not null default '[]'::jsonb,   -- [{ id, name, qty, price, mods }]
  subtotal numeric not null default 0,
  service_charge numeric not null default 0,
  tax numeric not null default 0,
  total numeric not null default 0,
  status text not null default 'pending',     -- pending | accepted | preparing | ready | served | delivered | paid | cancelled
  payment_status text not null default 'unpaid',
  payment_link text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ EVENTS / PRIVATE DINING ============
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  date date not null,
  start_time time,
  end_time time,
  capacity int,
  rsvp_count int not null default 0,
  price numeric,
  status text not null default 'upcoming',  -- upcoming | live | done | cancelled
  broadcast_sent boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists event_rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  phone_number text not null,
  name text,
  party_size int not null default 1,
  status text not null default 'confirmed', -- confirmed | waitlist | cancelled | attended
  created_at timestamptz not null default now(),
  unique(event_id, phone_number)
);

-- ============ FEEDBACK ============
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  phone_number text,
  reservation_id uuid references reservations(id),
  rating int,
  food_rating int,
  service_rating int,
  vibe_rating int,
  comments text,
  sentiment text,          -- positive | neutral | negative
  escalated boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============ MESSAGING (generic conversation infra, same as flows service expects) ============
create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  session_id text unique not null,          -- phone or web:<id>
  phone_number text,
  channel text not null default 'whatsapp', -- whatsapp | instagram | web
  status text not null default 'open',
  session_type text,
  ai_enabled boolean not null default true,
  needs_attention boolean not null default false,
  handoff_reason text,
  handoff_briefing text,
  last_message text,
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists chat_messages (
  id bigserial primary key,
  session_id text not null,
  sender text not null,          -- guest | ai | staff
  message text,
  media_url text,
  media_type text,
  wa_message_id text unique,
  status text,                   -- sent | delivered | read | failed
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_messages_session on chat_messages(session_id, created_at);

create table if not exists message_full (
  phone_number text primary key,
  conversation jsonb not null default '[]'::jsonb,
  conversation_summary text,
  updated_at timestamptz not null default now()
);

create table if not exists messages_buffer (
  id bigserial primary key,
  phone_number text not null,
  wa_message_id text unique,
  message text,
  media jsonb,
  created_at timestamptz not null default now()
);

create table if not exists pending_message_queue (
  id bigserial primary key,
  phone_number text not null,
  payload jsonb not null,
  attempts int not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create table if not exists routing_failures (
  id bigserial primary key,
  phone_number text,
  stage text,
  error text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id bigserial primary key,
  type text not null,            -- reservation | waitlist | order | handoff | feedback | system
  title text,
  body text,
  ref_id text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists staff_alerts (
  id bigserial primary key,
  severity text not null default 'info',
  message text not null,
  context jsonb,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
