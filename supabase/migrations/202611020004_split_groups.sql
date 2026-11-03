-- The Splits page (D-119). Additive and safe to re-run; existing rows keep working as before.

-- Groups of friends who share costs (roommates, a trip). Only who's in it: what each friend owes
-- stays on their account.
create table if not exists public.split_groups (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  id text not null check (char_length(id) between 1 and 80),
  seq bigint generated always as identity,
  name text not null check (char_length(name) between 1 and 60),
  member_ids text[] not null check (cardinality(member_ids) between 1 and 50),
  primary key (user_id, id)
);
alter table public.split_groups enable row level security;
revoke all on table public.split_groups from anon, authenticated;

-- Which group a split purchase was added in.
alter table public.transactions add column if not exists group_id text;
alter table public.transfers add column if not exists group_id text;

-- A friend's share of a purchase the user paid for is its own kind of transfer.
alter table public.transfers drop constraint if exists transfers_kind_check;
alter table public.transfers
  add constraint transfers_kind_check check (kind in ('transfer', 'card_payment', 'split'));
