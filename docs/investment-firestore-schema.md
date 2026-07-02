# Investment Module Firestore Schema

The current app uses Supabase in the existing household-finance features. This document keeps the requested Firestore collection shape ready for the investment module backend migration or Cloud Functions implementation.

## portfolios

- `id`: string
- `account_type`: `国内株` | `米国株`
- `broker`: string
- `label`: string

## holdings

- `id`: string
- `portfolio_id`: string
- `ticker`: string
- `name`: string
- `market`: `JP` | `US`
- `sector`: string
- `quantity`: number
- `avg_cost`: number
- `current_price`: number
- `currency`: `JPY` | `USD`
- `day_change_rate`: number
- `updated_at`: timestamp

## transactions_stock

- `id`: string
- `holding_id`: string
- `type`: `buy` | `sell`
- `quantity`: number
- `price`: number
- `currency`: `JPY` | `USD`
- `transaction_date`: date string
- `realized_pnl`: number

## watchlist

- `id`: string
- `ticker`: string
- `name`: string
- `market`: `JP` | `US`
- `sector`: string
- `added_date`: date string
- `added_price`: number
- `current_price`: number
- `currency`: `JPY` | `USD`
- `memo`: string

## news_items

- `id`: string
- `source`: string
- `ticker_tags`: string[]
- `related_tickers`: string[]
- `headline`: string
- `url`: string
- `published_at`: timestamp
- `importance_score`: number
- `category`: `company` | `macro`
- `audience`: `holding` | `watchlist` | `macro`

## earnings_calendar

- `id`: string
- `ticker`: string
- `name`: string
- `announce_date`: date string
- `timing`: `BMO` | `AMO` | `場中` | `場後`
- `eps_estimate`: number | null
- `revenue_estimate`: string | null

## fx_rates

- `id`: string
- `pair`: `USDJPY`
- `rate`: number
- `updated_at`: timestamp
