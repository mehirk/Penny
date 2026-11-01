-- Penny's persistent store. Every row belongs to one Supabase Auth user and is deleted with them.
--
-- Only the FastAPI service reads and writes these tables, over a direct Postgres connection
-- (PENNY_DATABASE_URL). Row level security is on with no policies and the API roles have no
-- grants, so the public Data API (anon / authenticated keys) can't read or change anything:
-- every financial write goes through the backend's deterministic, integer-cent domain code.
--
-- Money is bigint cents in CAD. Ids are the app's own text ids ("acct-chequing", "tx-…").
-- `seq` keeps each list in the order the app created it.

-- Profile, plus the version that guards against two devices saving over each other.
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  age integer check (age is null or age >= 18),
  school text check (char_length(school) <= 120),
  city text check (char_length(city) <= 80),
  province text check (char_length(province) <= 40),
  currency text not null default 'CAD' check (currency = 'CAD'),
  -- True for the seeded fictional demo data set.
  is_fictional boolean not null default false,
  state_version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.accounts (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  id text not null check (char_length(id) between 1 and 80),
  seq bigint generated always as identity,
  name text not null check (char_length(name) between 1 and 80),
  account_type text not null check (account_type in ('chequing', 'savings', 'credit', 'cash', 'investment', 'other')),
  balance_cents bigint not null check (balance_cents >= 0),
  credit_limit_cents bigint check (credit_limit_cents is null or credit_limit_cents >= 0),
  primary key (user_id, id)
);

create table public.categories (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  id text not null check (char_length(id) between 1 and 80),
  seq bigint generated always as identity,
  name text not null check (char_length(name) between 1 and 60),
  colour_token text not null,
  kind text not null check (kind in ('income', 'spending')),
  parent_id text,
  custom boolean not null default false,
  primary key (user_id, id)
);

create table public.transactions (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  id text not null check (char_length(id) between 1 and 80),
  seq bigint generated always as identity,
  description text not null check (char_length(description) between 1 and 160),
  -- Category name at the time of entry (display); category_id is the link.
  category text not null,
  account_id text not null,
  category_id text,
  amount_cents bigint not null check (amount_cents >= 0),
  kind text not null check (kind in ('income', 'spending')),
  occurred_on date not null,
  necessity text check (necessity in ('need', 'want')),
  auto_categorized boolean not null default false,
  bill_id text,
  paid_automatically boolean,
  unusual boolean not null default false,
  primary key (user_id, id)
);
create index transactions_user_date_idx on public.transactions (user_id, occurred_on);

create table public.budgets (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  id text not null check (char_length(id) between 1 and 80),
  seq bigint generated always as identity,
  category_id text not null,
  month_start date not null check (extract(day from month_start) = 1),
  limit_cents bigint not null check (limit_cents >= 0),
  primary key (user_id, id)
);

create table public.savings_goals (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  id text not null check (char_length(id) between 1 and 80),
  seq bigint generated always as identity,
  name text not null check (char_length(name) between 1 and 100),
  target_cents bigint not null check (target_cents > 0),
  current_cents bigint not null check (current_cents >= 0),
  target_date date,
  status text not null check (status in ('active', 'completed', 'paused')),
  account_id text,
  primary key (user_id, id)
);

-- Money moved into a goal. The id starts with the goal's id ("goal-laptop:1a2b3c4d").
create table public.goal_contributions (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  id text not null check (char_length(id) between 1 and 120),
  seq bigint generated always as identity,
  amount_cents bigint not null check (amount_cents > 0),
  from_account_id text not null,
  to_account_id text,
  occurred_on date not null,
  source text not null check (source in ('you', 'penny')),
  primary key (user_id, id)
);

create table public.bills (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  id text not null check (char_length(id) between 1 and 80),
  seq bigint generated always as identity,
  name text not null check (char_length(name) between 1 and 80),
  amount_cents bigint not null check (amount_cents > 0),
  category_id text,
  account_id text not null,
  frequency text not null check (frequency in ('weekly', 'biweekly', 'monthly', 'yearly')),
  next_due date not null,
  auto_record boolean not null,
  last_paid_on date,
  primary key (user_id, id)
);

create table public.pay_schedules (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  amount_cents bigint not null check (amount_cents > 0),
  account_id text not null,
  frequency text not null check (frequency in ('weekly', 'biweekly', 'semimonthly', 'monthly', 'custom')),
  next_payday date not null,
  interval_days integer check (interval_days is null or interval_days between 7 and 62)
);

create table public.missions (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  id text not null check (char_length(id) between 1 and 80),
  seq bigint generated always as identity,
  title text not null,
  description text not null,
  xp_reward integer not null check (xp_reward >= 0),
  completed boolean not null,
  primary key (user_id, id)
);

-- Learn: the learner's choices, passed lessons, active days, and quizzes in progress.
create table public.learn_profiles (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  country text check (country in ('CA', 'US')),
  topics text[] not null,
  start_tier text not null check (start_tier in ('easy', 'medium', 'hard'))
);

create table public.learn_results (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  lesson_id text not null,
  stars smallint not null check (stars between 0 and 3),
  xp_earned integer not null check (xp_earned >= 0),
  first_passed date not null,
  primary key (user_id, lesson_id)
);

create table public.learn_activity (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  day date not null,
  primary key (user_id, day)
);

create table public.learn_attempts (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  id text not null,
  lesson_id text not null,
  hearts_left integer not null check (hearts_left >= 0),
  -- The questions as shown (options shuffled per attempt); answers stay server-side in code.
  view jsonb not null,
  answered text[] not null default '{}',
  mistakes integer not null default 0 check (mistakes >= 0),
  status text not null check (status in ('active', 'passed', 'failed')),
  primary key (user_id, id)
);

-- Penny AI: saved chats, and changes it suggested (single use, applied only on approval).
create table public.coach_conversations (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  id text not null check (char_length(id) between 1 and 64),
  title text not null check (char_length(title) between 1 and 120),
  -- Approve / dismiss state of proposals shown in this chat, by proposal id.
  proposals jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index coach_conversations_recent_idx on public.coach_conversations (user_id, updated_at desc);

create table public.coach_messages (
  user_id uuid not null,
  conversation_id text not null,
  position integer not null check (position >= 0),
  id text not null check (char_length(id) between 1 and 64),
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 20000),
  -- Penny's full reply (verified facts, tools used, proposal) for assistant messages.
  reply jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, conversation_id, position),
  foreign key (user_id, conversation_id) references public.coach_conversations (user_id, id) on delete cascade
);

create table public.coach_proposals (
  id text primary key,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  version text not null,
  kind text not null check (kind in ('goal_contribution', 'budget_limit')),
  target_id text not null,
  expected_current_cents bigint not null,
  proposed_cents bigint not null,
  applied boolean not null default false,
  created_at timestamptz not null default now()
);
create index coach_proposals_user_idx on public.coach_proposals (user_id);

-- Email reminders: settings, what has already been emailed, and a log of sends.
create table public.reminder_settings (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  enabled boolean not null default false,
  email text check (char_length(email) <= 254),
  bills boolean not null default true,
  budgets boolean not null default true,
  streaks boolean not null default true,
  lessons boolean not null default false,
  updated_at timestamptz not null default now()
);
create index reminder_settings_enabled_idx on public.reminder_settings (user_id) where enabled;

create table public.reminder_sent_keys (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table public.reminder_emails (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  id text not null,
  sent_at timestamptz not null,
  to_address text not null,
  subject text not null,
  body_text text not null,
  status text not null check (status in ('sent', 'preview', 'failed')),
  trigger text not null check (trigger in ('scheduled', 'manual', 'test')),
  error text,
  primary key (user_id, id)
);
create index reminder_emails_recent_idx on public.reminder_emails (user_id, sent_at desc);

-- Lock the tables away from the Data API; the backend connects as the database owner.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'accounts', 'categories', 'transactions', 'budgets', 'savings_goals',
    'goal_contributions', 'bills', 'pay_schedules', 'missions', 'learn_profiles',
    'learn_results', 'learn_activity', 'learn_attempts', 'coach_conversations',
    'coach_messages', 'coach_proposals', 'reminder_settings', 'reminder_sent_keys',
    'reminder_emails'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end
$$;
