// lib/stock.ts
import type { StockQuote } from '@/types/stock'

export async function getStockPrice(ticker: string, market: 'JP' | 'US'): Promise<StockQuote> {
  const { default: YahooFinance } = await import('yahoo-finance2')
  const yf = new YahooFinance()
  const symbol = market === 'JP' ? `${ticker}.T` : ticker

  const quote = await yf.quote(symbol)

  return {
    ticker,
    price:     quote.regularMarketPrice ?? 0,
    currency:  quote.currency ?? (market === 'JP' ? 'JPY' : 'USD'),
    updatedAt: quote.regularMarketTime,
  }
}

export async function getUsdToJpy(): Promise<number> {
  try {
    const { default: YahooFinance } = await import('yahoo-finance2')
    const yf = new YahooFinance()
    const quote = await yf.quote('USDJPY=X')
    return quote.regularMarketPrice ?? 150
  } catch {
    return 150
  }
}
