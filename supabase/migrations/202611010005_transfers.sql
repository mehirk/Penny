-- Money moved between a person's own accounts (savings to chequing, or paying a credit card).
-- Penny only records it; it never moves real money. Not spending or income.
create table if not exists public.transfers (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  id text not null check (char_length(id) between 1 and 80),
  seq bigint generated always as identity,
  from_account_id text not null,
  to_account_id text not null,
  amount_cents bigint not null check (amount_cents > 0),
  occurred_on date not null,
  note text check (note is null or char_length(note) <= 120),
  kind text not null check (kind in ('transfer', 'card_payment')),
  primary key (user_id, id)
);
alter table public.transfers enable row level security;
revoke all on table public.transfers from anon, authenticated;
