-- Missions can now be a purchase question ("Can I buy it?") or a Watch mission Penny starts when
-- a purchase tips a budget over (D-139, D-138). The kind check listed only the first six kinds,
-- so saving those missions failed.
alter table public.agent_runs drop constraint if exists agent_runs_kind_check;
alter table public.agent_runs
  add constraint agent_runs_kind_check
  check (kind in ('checkup', 'free_money', 'life_event', 'payoff', 'purchase', 'custom', 'autopilot', 'watch'));
