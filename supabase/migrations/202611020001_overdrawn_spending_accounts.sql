-- Chequing and cash accounts can go below $0 (D-116): a purchase the user records is saved even
-- when Penny's balance is behind their bank's, and the account shows as overdrawn. Every other
-- account type still can't. Only relaxes a check, so it's safe to re-run and changes no rows.
alter table public.accounts drop constraint if exists accounts_balance_cents_check;
alter table public.accounts
  add constraint accounts_balance_cents_check
  check (balance_cents >= 0 or account_type in ('chequing', 'cash'));
