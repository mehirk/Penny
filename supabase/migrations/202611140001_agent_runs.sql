-- Mission Control: each mission Penny's agents ran (plan, every agent's trace and results, the
-- verifier's check, the drafted steps, and which ones the user approved), as the audit trail.
-- The 30 most recent are kept per person. Nothing here holds money: approved steps are applied
-- to the person's own tables like any other change.
create table public.agent_runs (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  id text not null check (char_length(id) between 1 and 64),
  kind text not null check (kind in ('checkup', 'free_money', 'life_event', 'payoff', 'custom', 'autopilot')),
  status text not null check (status in ('running', 'done', 'failed')),
  run jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index agent_runs_recent_idx on public.agent_runs (user_id, created_at desc);

-- Only the API reads and writes, like every other table.
alter table public.agent_runs enable row level security;
revoke all on table public.agent_runs from anon, authenticated;
