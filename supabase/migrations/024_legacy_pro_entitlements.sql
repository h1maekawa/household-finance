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

-- 付与。user_entitlements.user_id は主キーなので二重行にはならない。
--
-- do nothing にしないのは、cutoff 以前のユーザーが「Pro 相当ではない
-- entitlement 行」を既に持っていた場合に救済漏れになるため。
-- fail-closed 化の目的は「以前から使えていた人を突然使えなくしない」ことなので、
-- Pro 相当でない行は legacy_pro / active へ引き上げる。
--
-- 一方で、有効な買い切り Pro を上書きしてはいけない。
-- where 句で「Pro 相当かつ active」の行だけを除外している。
-- 再実行時は対象行が active legacy_pro になっているため条件を満たさず、何も起きない。
insert into user_entitlements (user_id, plan, status, source, purchased_at, updated_at)
select u.id, 'legacy_pro', 'active', 'legacy', now(), now()
from auth.users u
cross join billing_legacy_cutoff c
where u.created_at <= c.cutoff_at
on conflict (user_id) do update
  set plan = 'legacy_pro',
      status = 'active',
      source = 'legacy',
      updated_at = now()
  where user_entitlements.status is distinct from 'active'
     or user_entitlements.plan not in ('pro', 'pro_lifetime', 'legacy_pro');
