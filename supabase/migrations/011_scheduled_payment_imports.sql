-- One-time scheduled payments imported from Gmail bank notices.

alter table scheduled_payments
  add column if not exists scheduled_date date;

alter table scheduled_payments
  add column if not exists external_id text;

alter table scheduled_payments
  add column if not exists source text not null default 'manual';

create unique index if not exists scheduled_payments_user_external_id_idx
  on scheduled_payments (user_id, external_id)
  where external_id is not null;

grant all on scheduled_payments to authenticated;
grant all on scheduled_payments to service_role;
