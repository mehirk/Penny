-- The day of the month a credit card's payment is due (D-100). Additive and safe to re-run;
-- existing cards start without one and can add it in Settings › Accounts.
alter table public.accounts
  add column if not exists payment_due_day smallint
  check (payment_due_day is null or payment_due_day between 1 and 31);
