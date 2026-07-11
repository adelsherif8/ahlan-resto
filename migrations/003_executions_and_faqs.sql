-- Run in the RESTAURANT tenant project (sxthftiqvaojbdyjizjr) SQL editor.
-- 1) Persistent flow executions (ops console history survives redeploys, enables cost reports)
-- 2) Bot-suggested FAQs (the agent proposes; staff approve in Settings)

create table if not exists flow_executions (
  id text primary key,
  flow text not null,
  session_id text,
  trigger text,
  status text not null,
  error text,
  started_at timestamptz not null,
  finished_at timestamptz,
  duration_ms int,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  cost_usd numeric not null default 0,
  nodes jsonb not null default '[]'::jsonb,
  children jsonb not null default '[]'::jsonb,
  parent_id text,
  created_at timestamptz not null default now()
);
create index if not exists idx_flow_exec_flow on flow_executions(flow, started_at desc);
create index if not exists idx_flow_exec_started on flow_executions(started_at desc);

create table if not exists suggested_faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  context text,                       -- what the guest actually said / handoff briefing
  session_id text,
  status text not null default 'pending',  -- pending | approved | dismissed
  suggested_answer text,
  created_at timestamptz not null default now()
);
