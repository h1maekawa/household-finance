-- Cashflow prediction settings:
-- - income_day: monthly salary/deposit date
-- - numeric credit card closing/payment days for automatic billing forecasts

alter table users_profile
  add column if not exists income_day integer not null default 25
  check (income_day between 1 and 31);

alter table credit_cards
  add column if not exists closing_day_int integer not null default 31
  check (closing_day_int between 1 and 31);

alter table credit_cards
  add column if not exists payment_day_int integer not null default 27
  check (payment_day_int between 1 and 31);

alter table credit_cards
  add column if not exists payment_month_offset integer not null default 1
  check (payment_month_offset between 0 and 2);

grant all on users_profile to authenticated;
grant all on credit_cards to authenticated;
grant all on users_profile to service_role;
grant all on credit_cards to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'credit_cards'
      and policyname = 'select_own'
  ) then
    create policy select_own on credit_cards for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'credit_cards'
      and policyname = 'insert_own'
  ) then
    create policy insert_own on credit_cards for insert with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'credit_cards'
      and policyname = 'update_own'
  ) then
    create policy update_own on credit_cards for update using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'credit_cards'
      and policyname = 'delete_own'
  ) then
    create policy delete_own on credit_cards for delete using (auth.uid() = user_id);
  end if;
end $$;
