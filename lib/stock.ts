// lib/stock.ts
import type { StockQuote } from '@/types/stock'

export async function getStockPrice(ticker: string, market: 'JP' | 'US'): Promise<StockQuote> {
  // yahoo-finance2はサーバーサイドのみで使用（dynamic importで読み込み）
  const yahooFinance = (await import('yahoo-finance2')).default
  const symbol = market === 'JP' ? `${ticker}.T` : ticker

  const quote = await yahooFinance.quote(symbol)

  return {
    ticker,
    price: quote.regularMarketPrice ?? 0,
    currency: quote.currency ?? (market === 'JP' ? 'JPY' : 'USD'),
    updatedAt: quote.regularMarketTime,
  }
}

/**
 * USD → JPY 変換（簡易版）
 * 本番ではExchangeRate APIなどを使用すること
 */
export async function getUsdToJpy(): Promise<number> {
  try {
    const yahooFinance = (await import('yahoo-finance2')).default
    const quote = await yahooFinance.quote('USDJPY=X')
    return quote.regularMarketPrice ?? 150
  } catch {
    return 150 // フォールバック値
  }
}
