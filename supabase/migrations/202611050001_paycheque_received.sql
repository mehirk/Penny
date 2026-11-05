-- "I got paid" (D-120). Additive and safe to re-run; existing rows keep working as before.

-- A paycheque the user marked as received, linked to its source of pay.
alter table public.transactions add column if not exists pay_id text;
