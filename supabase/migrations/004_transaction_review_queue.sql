-- Add a lightweight review queue for imported transactions that need human labeling.

alter table transactions
  add column if not exists needs_review boolean not null default false;

alter table transactions
  add column if not exists review_reason text;

create index if not exists transactions_user_needs_review_idx
  on transactions (user_id, needs_review, date desc)
  where needs_review = true;
