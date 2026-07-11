import { StockHoldingInput, StockMarket } from '@/types/stock'

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

export function parseRakutenStockCsv(text: string): StockHoldingInput[] {
  const rows = parseCsvRows(text).filter(row => row.some(cell => cell.trim()))
  if (rows.length < 2) return []

  const headers = rows[0].map(normalizeHeader)
  const dataRows = rows.slice(1).map(row => toRow(headers, row))

  return dataRows
    .map(row => toHolding(row, headers))
    .filter((holding): holding is StockHoldingInput => Boolean(holding))
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

function parseNumber(value: string) {
  const normalized = value
    .replace(/[,"%円株\s]/g, '')
    .replace(/USドル|USD|ドル/g, '')
    .replace(/△/g, '-')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
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
