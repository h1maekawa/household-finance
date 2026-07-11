-- Paid entitlements and per-user GAS import secrets.

create table if not exists user_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'pro_lifetime',
  status text not null default 'active',
  source text not null default 'stripe',
  stripe_customer_id text,
  stripe_checkout_session_id text,
  purchased_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_import_secrets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  secret_hash text not null unique,
  label text not null default 'GAS',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table user_entitlements enable row level security;
alter table user_import_secrets enable row level security;

drop policy if exists select_own on user_entitlements;
drop policy if exists select_own on user_import_secrets;
drop policy if exists insert_own on user_import_secrets;
drop policy if exists update_own on user_import_secrets;
drop policy if exists delete_own on user_import_secrets;

create policy select_own on user_entitlements
  for select
  using (auth.uid() = user_id);

create policy select_own on user_import_secrets
  for select
  using (auth.uid() = user_id);

create policy insert_own on user_import_secrets
  for insert
  with check (auth.uid() = user_id);

create policy update_own on user_import_secrets
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy delete_own on user_import_secrets
  for delete
  using (auth.uid() = user_id);

grant select on user_entitlements to authenticated;
grant select, insert, update, delete on user_import_secrets to authenticated;
grant all on user_entitlements to service_role;
grant all on user_import_secrets to service_role;
