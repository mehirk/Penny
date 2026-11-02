-- D-117. Additive and safe to re-run; existing rows keep working as before.
--
-- Bills remember the day of the month they're usually due (so the 31st stays the 31st after
-- February), and can have one payment moved without moving the rest (`usual_due` is the date that
-- payment would usually have been due). Existing bills start with both empty; Penny fills in
-- the usual day from their next due date.
alter table public.bills
  add column if not exists due_day smallint check (due_day is null or due_day between 1 and 31),
  add column if not exists usual_due date;

-- Friends you share costs with are a new account type ("person"). Their balance is what they owe
-- you (positive) or what you owe them (negative).
alter table public.accounts drop constraint if exists accounts_account_type_check;
alter table public.accounts
  add constraint accounts_account_type_check
  check (account_type in ('chequing', 'savings', 'credit', 'cash', 'investment', 'other', 'person'));

alter table public.accounts drop constraint if exists accounts_balance_cents_check;
alter table public.accounts
  add constraint accounts_balance_cents_check
  check (balance_cents >= 0 or account_type in ('chequing', 'cash', 'person'));
