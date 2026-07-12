-- Link fixed scheduled payments to a withdrawal bank account.

alter table scheduled_payments
  add column if not exists bank_account text;

grant all on scheduled_payments to authenticated;
grant all on scheduled_payments to service_role;
