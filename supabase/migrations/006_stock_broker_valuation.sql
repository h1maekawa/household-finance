-- Store brokerage valuation values imported from Rakuten Securities CSV.
-- These values are used as the primary portfolio valuation when present,
-- while Yahoo Finance remains available as a reference quote.

alter table stock_holdings
  add column if not exists broker_current_value numeric,
  add column if not exists broker_gain_loss numeric,
  add column if not exists broker_gain_loss_rate numeric,
  add column if not exists broker_current_price numeric,
  add column if not exists broker_price_currency text,
  add column if not exists broker_fx_rate numeric,
  add column if not exists broker_snapshot_at timestamptz;

grant select, insert, update, delete on stock_holdings to authenticated;
grant all on stock_holdings to service_role;
