-- The courier roster: assign by name, reuse across orders, no retyping.
-- NOTE: phone column is phone_number — the tenant-wide naming invariant.
create table if not exists couriers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone_number text,
  branch text,
  active boolean default true,
  created_at timestamptz default now()
);
