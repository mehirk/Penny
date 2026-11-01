-- Which accounts count as spending money for Safe to spend (D-091).
-- Additive and safe to re-run: existing users default to chequing (and cash) only.
alter table public.profiles
  add column if not exists spending_from text not null default 'chequing'
  check (spending_from in ('chequing', 'chequing_and_savings'));
