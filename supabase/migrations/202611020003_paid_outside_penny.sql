-- Things the user paid before telling Penny (D-118). Additive and safe to re-run; existing rows
-- keep working as before.
--
-- A credit card payment made outside Penny: said in setup ("next payment is next month's") or
-- with "Already paid? Just record it". It counts like a recorded card payment for its cycle.
alter table public.accounts
  add column if not exists card_paid_on date;

-- A transaction already included in the balance the user entered: it's in history, budgets, and
-- charts, but never changes a balance (added, edited, or removed).
alter table public.transactions
  add column if not exists history_only boolean not null default false;
