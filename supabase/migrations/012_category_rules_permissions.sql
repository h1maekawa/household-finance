-- Per-user merchant/category rules used for Gmail import and recategorization.

create table if not exists merchant_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  merchant_pattern text not null,
  category text not null,
  payment_method text,
  confidence numeric not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table merchant_rules enable row level security;

grant all on merchant_rules to authenticated;
grant all on merchant_rules to service_role;

create unique index if not exists merchant_rules_user_pattern_category_idx
  on merchant_rules (user_id, merchant_pattern, category);

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'merchant_rules'
      and policyname = 'select_own'
  ) then
    create policy select_own on merchant_rules for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'merchant_rules'
      and policyname = 'insert_own'
  ) then
    create policy insert_own on merchant_rules for insert with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'merchant_rules'
      and policyname = 'update_own'
  ) then
    create policy update_own on merchant_rules for update using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'merchant_rules'
      and policyname = 'delete_own'
  ) then
    create policy delete_own on merchant_rules for delete using (auth.uid() = user_id);
  end if;
end $$;
