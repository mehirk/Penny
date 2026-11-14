-- Who Penny is coaching, picked before setup (D-124): a student, someone working, or someone
-- learning first. Empty until picked.
alter table public.profiles
  add column if not exists persona text
  check (persona in ('student', 'working', 'learner'));
