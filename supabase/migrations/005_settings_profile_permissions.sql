-- Settings screen profile/balance permissions.
-- Run this in Supabase SQL Editor when the settings save API returns:
-- "permission denied for table users_profile".

grant usage on schema public to authenticated;

alter table if exists users_profile enable row level security;
alter table if exists account_balance enable row level security;

drop policy if exists select_own on users_profile;
drop policy if exists insert_own on users_profile;
drop policy if exists update_own on users_profile;
drop policy if exists delete_own on users_profile;

create policy select_own on users_profile
  for select
  using (auth.uid() = user_id);

create policy insert_own on users_profile
  for insert
  with check (auth.uid() = user_id);

create policy update_own on users_profile
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy delete_own on users_profile
  for delete
  using (auth.uid() = user_id);

drop policy if exists select_own on account_balance;
drop policy if exists insert_own on account_balance;
drop policy if exists update_own on account_balance;
drop policy if exists delete_own on account_balance;

create policy select_own on account_balance
  for select
  using (auth.uid() = user_id);

create policy insert_own on account_balance
  for insert
  with check (auth.uid() = user_id);

create policy update_own on account_balance
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy delete_own on account_balance
  for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on users_profile to authenticated;
grant select, insert, update, delete on account_balance to authenticated;

grant all on users_profile to service_role;
grant all on account_balance to service_role;
