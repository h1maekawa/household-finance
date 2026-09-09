-- Stripe Webhook の冪等性と再処理。
--
-- event_id を主キーにして二重適用を防ぐだけでなく、状態を持たせる。
-- 「event_id は保存したが業務処理に失敗した」イベントを failed として残し、
-- Stripe の再送で処理し直せるようにするため。
--
--   processing … 受理して処理中。異常終了するとここで止まる
--   processed  … 業務処理まで成功。二度と適用しない
--   failed     … 業務処理に失敗。再送されたら処理し直す

create table if not exists stripe_events (
  event_id text primary key,
  event_type text not null,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed')),
  attempts integer not null default 1,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists stripe_events_status_idx on stripe_events (status);

alter table stripe_events enable row level security;
-- ポリシーを作らない = service_role 以外からは読めない。
-- 課金の内部ログであり、ユーザーへ見せるものではない。
