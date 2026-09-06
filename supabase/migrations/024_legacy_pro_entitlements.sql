-- 課金チェックを fail-closed にする際の、既存ユーザーの救済。
--
-- これまで NEXT_PUBLIC_BILLING_REQUIRED が未設定なら全機能が開放されていた。
-- fail-closed へ切り替えると既存利用者が突然 Free へ落ちるため、
-- 「切り替え時点で存在したユーザー」に legacy_pro を付与して現状を維持する。
--
-- legacy_pro は Pro 相当として扱うが、Subscription を要求しない。
-- 新規課金ユーザー(pro)とは区別し、将来まとめて移行できるようにする。

-- 切替時刻を1行だけ記録する。このマイグレーションを後から再実行しても、
-- ここに入っている時刻より後にサインアップしたユーザーへは付与しない。
-- (再実行で新規ユーザーまで legacy_pro になるのを防ぐ)
create table if not exists billing_legacy_cutoff (
  id boolean primary key default true check (id),
  cutoff_at timestamptz not null default now(),
  note text
);

insert into billing_legacy_cutoff (id, note)
values (true, 'fail-closed 切替時点。これ以前のユーザーだけが legacy_pro の対象')
on conflict (id) do nothing;

alter table billing_legacy_cutoff enable row level security;
-- ポリシーなし = service_role 専用

-- 付与。user_entitlements.user_id は主キーなので、
-- 既に entitlement を持つユーザー(買い切り済みなど)は on conflict で触らない。
-- 再実行しても二重にならない。
insert into user_entitlements (user_id, plan, status, source, purchased_at, updated_at)
select u.id, 'legacy_pro', 'active', 'legacy', now(), now()
from auth.users u
cross join billing_legacy_cutoff c
where u.created_at <= c.cutoff_at
on conflict (user_id) do nothing;
