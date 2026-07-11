import { StockHoldingInput, StockMarket } from '@/types/stock'
import { InvestmentTransactionInput } from '@/types/investment-transaction'

type CsvRow = Record<string, string>

export async function readRakutenStockCsv(file: File): Promise<StockHoldingInput[]> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const decoded = hasBom || !utf8.includes('\uFFFD')
    ? utf8.replace(/^\uFEFF/, '')
    : new TextDecoder('shift-jis').decode(bytes)

  return parseRakutenStockCsv(decoded)
}

export async function readRakutenStockTransactions(file: File): Promise<InvestmentTransactionInput[]> {
  const text = await readCsvText(file)
  return parseRakutenStockTransactions(text)
}

export function parseRakutenStockTransactions(text: string): InvestmentTransactionInput[] {
  const rows = parseCsvRows(text).filter(row => row.some(cell => cell.trim()))
  if (rows.length < 2) return []

  const headers = rows[0].map(normalizeHeader)
  if (!isTradeHistory(headers)) return []

  return rows.slice(1)
    .map(row => toRow(headers, row))
    .map(toStockTransaction)
    .filter((tx): tx is InvestmentTransactionInput => Boolean(tx))
}

export function parseRakutenStockCsv(text: string): StockHoldingInput[] {
  const rows = parseCsvRows(text).filter(row => row.some(cell => cell.trim()))
  if (rows.length < 2) return []

  const assetBalanceHeaderIndex = findAssetBalanceDetailHeader(rows)
  if (assetBalanceHeaderIndex >= 0) {
    return parseStockAssetBalance(
      rows[assetBalanceHeaderIndex].map(normalizeHeader),
      rows.slice(assetBalanceHeaderIndex + 1),
    )
  }

  const headers = rows[0].map(normalizeHeader)
  if (isTradeHistory(headers)) {
    return parseStockTradeHistory(headers, rows.slice(1))
  }

  const dataRows = rows.slice(1).map(row => toRow(headers, row))

  return dataRows
    .map(row => toHolding(row, headers))
    .filter((holding): holding is StockHoldingInput => Boolean(holding))
}

async function readCsvText(file: File) {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  return hasBom || !utf8.includes('\uFFFD')
    ? utf8.replace(/^\uFEFF/, '')
    : new TextDecoder('shift-jis').decode(bytes)
}

function findAssetBalanceDetailHeader(rows: string[][]) {
  return rows.findIndex(row => {
    const headers = row.map(normalizeHeader)
    return headers.includes('種別') && headers.includes('銘柄コード・ティッカー') && headers.includes('時価評価額[円]')
  })
}

function parseStockAssetBalance(headers: string[], rows: string[][]): StockHoldingInput[] {
  return rows
    .map(row => toRow(headers, row))
    .filter(row => pick(row, ['種別']) === '米国株式' || pick(row, ['種別']) === '国内株式')
    .map(row => {
      const market: StockMarket = pick(row, ['種別']) === '米国株式' ? 'US' : 'JP'
      const shares = pickNumber(row, ['保有数量'])
      const averageCost = pickNumber(row, ['平均取得価額'])
      const currentPrice = pickNumber(row, ['現在値'])
      const currentValue = pickNumber(row, ['時価評価額[円]'])
      const gainLoss = pickNumber(row, ['評価損益[円]'])
      return {
        ticker: pick(row, ['銘柄コード・ティッカー']).toUpperCase(),
        name: pick(row, ['銘柄']),
        market,
        shares,
        average_cost: market === 'US'
          ? Math.round(averageCost * inferFx(currentValue, shares, currentPrice))
          : Math.round(averageCost),
        broker_current_value: currentValue || null,
        broker_gain_loss: gainLoss || null,
        broker_gain_loss_rate: pickPercent(row, ['評価損益[％]']),
        broker_current_price: currentPrice || null,
        broker_price_currency: market === 'US' ? 'USD' : 'JPY',
        broker_fx_rate: market === 'US' ? inferFx(currentValue, shares, currentPrice) : null,
        broker_snapshot_at: new Date().toISOString(),
      }
    })
    .filter(holding => holding.ticker && holding.shares > 0)
}

function isTradeHistory(headers: string[]) {
  return headers.includes('約定日') && headers.includes('ティッカー') && headers.includes('売買区分')
}

function parseStockTradeHistory(headers: string[], rows: string[][]): StockHoldingInput[] {
  type Aggregate = {
    ticker: string
    name: string
    market: StockMarket
    shares: number
    costTotal: number
  }

  const aggregates = new Map<string, Aggregate>()

  rows
    .map(row => toRow(headers, row))
    .forEach(row => {
      const ticker = pick(row, ['ティッカー']).toUpperCase()
      if (!ticker) return

      const name = pick(row, ['銘柄名']) || ticker
      const key = `US:${ticker}`
      const current = aggregates.get(key) ?? {
        ticker,
        name,
        market: 'US' as StockMarket,
        shares: 0,
        costTotal: 0,
      }
      const quantity = pickNumber(row, ['数量［株］', '数量[株]', '数量'])
      if (quantity <= 0) return

      const tradeType = pick(row, ['売買区分', '取引区分'])
      const yenAmount = pickNumber(row, ['受渡金額［円］', '受渡金額[円]', '約定代金［円］', '約定代金[円]'])
      const usdAmount = pickNumber(row, ['約定代金［USドル］', '約定代金[USドル]', '受渡金額［USドル］', '受渡金額[USドル]'])
      const fx = pickNumber(row, ['為替レート'])
      const buyCost = yenAmount > 0 ? yenAmount : usdAmount > 0 && fx > 0 ? usdAmount * fx : 0

      if (/売/.test(tradeType)) {
        const averageCost = current.shares > 0 ? current.costTotal / current.shares : 0
        current.shares -= quantity
        current.costTotal -= averageCost * quantity
      } else if (/入庫|分割/.test(tradeType)) {
        current.shares += quantity
      } else {
        current.shares += quantity
        current.costTotal += buyCost
      }

      if (current.shares <= 0) {
        current.shares = 0
        current.costTotal = 0
      }

      aggregates.set(key, current)
    })

  return Array.from(aggregates.values())
    .filter(item => item.shares > 0)
    .map(item => ({
      ticker: item.ticker,
      name: item.name,
      market: item.market,
      shares: item.shares,
      average_cost: item.shares > 0 ? Math.round(item.costTotal / item.shares) : 0,
      broker_current_value: null,
      broker_gain_loss: null,
      broker_gain_loss_rate: null,
      broker_current_price: null,
      broker_price_currency: 'USD',
      broker_fx_rate: null,
      broker_snapshot_at: new Date().toISOString(),
    }))
}

function toHolding(row: CsvRow, headers: string[]): StockHoldingInput | null {
  const ticker = pick(row, ['ティッカー', '銘柄コード', 'コード', '現地コード']).toUpperCase()
  if (!ticker) return null

  const market = detectMarket(headers, row)
  const shares = pickNumber(row, ['保有数量', '保有株数', '数量', '株数'])
  const averageCost = pickNumber(row, [
    '平均取得価額(円)',
    '平均取得単価(円)',
    '取得単価(円)',
    '取得単価',
    '平均取得価額',
  ])
  const brokerCurrentValue = pickNumber(row, [
    '評価額(円)',
    '評価額',
    '時価評価額(円)',
    '時価評価額',
    '評価金額(円)',
    '評価金額',
  ])
  const brokerGainLoss = pickNumber(row, [
    '評価損益(円)',
    '評価損益',
    '評価損益額(円)',
    '評価損益額',
    '損益(円)',
    '損益',
  ])
  const brokerGainLossRate = pickPercent(row, [
    '評価損益率(%)',
    '評価損益率',
    '損益率(%)',
    '損益率',
  ])
  const brokerCurrentPrice = pickNumber(row, [
    '現在値(USドル)',
    '現在値(USD)',
    '現在値(円)',
    '現在値',
    '株価',
  ])
  const priceCurrency = market === 'US' ? 'USD' : 'JPY'
  const brokerFxRate = market === 'US' && brokerCurrentValue > 0 && brokerCurrentPrice > 0 && shares > 0
    ? brokerCurrentValue / shares / brokerCurrentPrice
    : null

  return {
    ticker,
    name: pick(row, ['銘柄名', '名称', '商品名']) || ticker,
    market,
    shares,
    average_cost: averageCost,
    broker_current_value: brokerCurrentValue || null,
    broker_gain_loss: brokerGainLoss || null,
    broker_gain_loss_rate: brokerGainLossRate,
    broker_current_price: brokerCurrentPrice || null,
    broker_price_currency: priceCurrency,
    broker_fx_rate: brokerFxRate,
    broker_snapshot_at: new Date().toISOString(),
  }
}

function toStockTransaction(row: CsvRow): InvestmentTransactionInput | null {
  const ticker = pick(row, ['ティッカー']).toUpperCase()
  if (!ticker) return null

  const tradeDate = toIsoDate(pick(row, ['約定日']))
  if (!tradeDate) return null

  const settlementDate = toIsoDate(pick(row, ['受渡日']))
  const quantity = pickNumber(row, ['数量［株］', '数量[株]', '数量'])
  const unitPrice = pickNumber(row, ['単価［USドル］', '単価[USドル]', '単価'])
  const amountForeign = pickNumber(row, ['約定代金［USドル］', '約定代金[USドル]', '受渡金額［USドル］', '受渡金額[USドル]'])
  const amountJpy = pickNumber(row, ['受渡金額［円］', '受渡金額[円]'])
  const fxRate = pickNumber(row, ['為替レート'])
  const tradeType = pick(row, ['売買区分', '取引区分']) || '取引'

  return {
    asset_type: 'stock',
    symbol: ticker,
    name: pick(row, ['銘柄名']) || ticker,
    account_type: pick(row, ['口座']) || null,
    trade_type: tradeType,
    trade_date: tradeDate,
    settlement_date: settlementDate,
    quantity,
    unit_price: unitPrice,
    amount_jpy: amountJpy || (amountForeign && fxRate ? Math.round(amountForeign * fxRate) : 0),
    amount_foreign: amountForeign || null,
    currency: pick(row, ['決済通貨']) || 'JPY',
    fx_rate: fxRate || null,
    source: 'rakuten_stock_tradehistory',
    external_id: [
      'rakuten-stock',
      tradeDate,
      settlementDate,
      ticker,
      tradeType,
      quantity,
      unitPrice,
      amountJpy,
      amountForeign,
    ].join(':'),
  }
}

function detectMarket(headers: string[], row: CsvRow): StockMarket {
  const marketText = pick(row, ['市場', '取引所', '口座区分'])
  if (/米国|US|NASDAQ|NYSE/i.test(marketText)) return 'US'
  if (headers.some(header => /USドル|USD|ティッカー/.test(header))) return 'US'
  return 'JP'
}

function pick(row: CsvRow, names: string[]) {
  for (const name of names) {
    const value = row[normalizeHeader(name)]
    if (value?.trim()) return value.trim()
  }
  return ''
}

function pickNumber(row: CsvRow, names: string[]) {
  return parseNumber(pick(row, names))
}

function pickPercent(row: CsvRow, names: string[]) {
  const value = pick(row, names)
  if (!value) return null
  const parsed = parseNumber(value)
  if (!Number.isFinite(parsed)) return null
  return Math.abs(parsed) > 10 ? parsed / 100 : parsed
}

function toRow(headers: string[], row: string[]) {
  return headers.reduce<CsvRow>((acc, header, index) => {
    acc[header] = row[index] ?? ''
    return acc
  }, {})
}

function normalizeHeader(header: string) {
  return header.trim().replace(/^\uFEFF/, '').replace(/\s/g, '')
}

function toIsoDate(value: string) {
  const match = value.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/)
  if (!match) return null
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

function parseNumber(value: string) {
  const normalized = value
    .replace(/[,"%円株+％\s]/g, '')
    .replace(/USドル|USD|ドル/g, '')
    .replace(/△/g, '-')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function inferFx(currentValue: number, shares: number, currentPrice: number) {
  if (currentValue <= 0 || shares <= 0 || currentPrice <= 0) return 0
  return currentValue / shares / currentPrice
}

function parseCsvRows(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (char === '"' && quoted && next === '"') {
      cell += '"'
      i += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  if (cell || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}
