-- The courier roster: assign by name, reuse across orders, no retyping.
create table if not exists couriers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  branch text,
  active boolean default true,
  created_at timestamptz default now()
);
