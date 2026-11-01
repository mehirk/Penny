-- Several sources of pay per person (a job, a scholarship, an allowance), not just one.
-- Existing rows become "pay-main"; the key becomes (user_id, id).
alter table public.pay_schedules add column if not exists id text;
update public.pay_schedules set id = 'pay-main' where id is null;
alter table public.pay_schedules alter column id set not null;
alter table public.pay_schedules drop constraint if exists pay_schedules_id_check;
alter table public.pay_schedules add constraint pay_schedules_id_check check (char_length(id) between 1 and 80);
alter table public.pay_schedules drop constraint if exists pay_schedules_pkey;
alter table public.pay_schedules add primary key (user_id, id);
