-- Stripe Subscription のローカル状態。
--
-- Stripe を課金の Source of Truth とし、ここには Feature Authorization に
-- 必要な最小限だけを持つ。Stripe オブジェクト全体を複製しない。
--
-- 既存の user_entitlements は削除しない。買い切りユーザーはそちらに残り、
-- 権限判定は「Subscription → 無ければ Entitlement」の順で解決する。

create table if not exists user_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  stripe_price_id text,
  -- Stripe の subscription.status をそのまま持つ
  -- (active / trialing / past_due / canceled / incomplete / incomplete_expired / unpaid / paused)
  status text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_subscriptions_customer_idx
  on user_subscriptions (stripe_customer_id);

alter table user_subscriptions enable row level security;

-- 自分の契約状態だけ読める。書き込みは Webhook (service_role) のみ。
-- insert/update/delete のポリシーを作らない = ユーザーからは書けない。
drop policy if exists "user_subscriptions_select_own" on user_subscriptions;
create policy "user_subscriptions_select_own" on user_subscriptions
  for select using (auth.uid() = user_id);
