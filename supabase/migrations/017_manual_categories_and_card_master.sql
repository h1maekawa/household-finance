-- Version 1.2: preserve automatic suggestions separately and always prefer
-- the category explicitly selected by the user.

alter table transactions
  add column if not exists manual_category text,
  add column if not exists auto_category text;

comment on column transactions.manual_category is
  'User-selected category. When present this is authoritative.';
comment on column transactions.auto_category is
  'Optional machine/rule suggestion retained for a future assistive classifier.';

-- Existing rows were already visible to users as classified data. Preserve that
-- intent instead of silently resetting historical reports.
update transactions
set manual_category = category
where manual_category is null
  and category is distinct from '未分類';

alter table credit_cards
  add column if not exists bank_account text;

comment on column credit_cards.bank_account is
  'Bank account used to withdraw this card bill.';

grant all on transactions to authenticated;
grant all on transactions to service_role;
grant all on credit_cards to authenticated;
grant all on credit_cards to service_role;
