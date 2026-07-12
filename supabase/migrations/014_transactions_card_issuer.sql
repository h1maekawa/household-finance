-- Store the card issuer detected from Gmail import metadata.

alter table transactions
  add column if not exists card_issuer text;

create index if not exists transactions_user_card_issuer_idx
  on transactions (user_id, card_issuer)
  where card_issuer is not null;

grant all on transactions to authenticated;
grant all on transactions to service_role;
