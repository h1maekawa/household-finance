import { FundHoldingInput } from '@/types/fund'
import { InvestmentTransactionInput } from '@/types/investment-transaction'

type CsvRow = Record<string, string>

export async function readRakutenFundCsv(file: File): Promise<FundHoldingInput[]> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const decoded = hasBom || !utf8.includes('\uFFFD')
    ? utf8.replace(/^\uFEFF/, '')
    : new TextDecoder('shift-jis').decode(bytes)

  return parseRakutenFundCsv(decoded)
}

export async function readRakutenFundTransactions(file: File): Promise<InvestmentTransactionInput[]> {
  const text = await readCsvText(file)
  return parseRakutenFundTransactions(text)
}

export function parseRakutenFundTransactions(text: string): InvestmentTransactionInput[] {
  const rows = parseCsvRows(text).filter(row => row.some(cell => cell.trim()))
  if (rows.length < 2) return []

  const headers = rows[0].map(normalizeHeader)
  if (!isTradeHistory(headers)) return []

  return rows.slice(1)
    .map(row => toRow(headers, row))
    .map(toFundTransaction)
    .filter((tx): tx is InvestmentTransactionInput => Boolean(tx))
}

export function parseRakutenFundCsv(text: string): FundHoldingInput[] {
  const rows = parseCsvRows(text).filter(row => row.some(cell => cell.trim()))
  if (rows.length < 2) return []

  const assetBalanceHeaderIndex = findAssetBalanceDetailHeader(rows)
  if (assetBalanceHeaderIndex >= 0) {
    return parseFundAssetBalance(
      rows[assetBalanceHeaderIndex].map(normalizeHeader),
      rows.slice(assetBalanceHeaderIndex + 1),
    )
  }

  const headers = rows[0].map(normalizeHeader)
  if (isTradeHistory(headers)) {
    return parseFundTradeHistory(headers, rows.slice(1))
  }

  return rows
    .slice(1)
    .map(row => toRow(headers, row))
    .map(toFund)
    .filter((fund): fund is FundHoldingInput => Boolean(fund))
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
    return headers.includes('種別') && headers.includes('銘柄') && headers.includes('時価評価額[円]')
  })
}

function parseFundAssetBalance(headers: string[], rows: string[][]): FundHoldingInput[] {
  return rows
    .map(row => toRow(headers, row))
    .filter(row => pick(row, ['種別']) === '投資信託')
    .map(row => ({
      name: pick(row, ['銘柄']),
      account_type: pick(row, ['口座']) || null,
      units: pickNumber(row, ['保有数量']),
      average_cost: pickNumber(row, ['平均取得価額']),
      base_price: pickNumber(row, ['現在値']),
      current_value: pickNumber(row, ['時価評価額[円]']),
      gain_loss: pickNumber(row, ['評価損益[円]']),
      gain_loss_rate: pickPercent(row, ['評価損益[％]']),
      broker_snapshot_at: new Date().toISOString(),
    }))
    .filter(fund => fund.name && fund.units > 0)
}

function isTradeHistory(headers: string[]) {
  return headers.includes('約定日') && headers.includes('ファンド名') && headers.includes('取引')
}

function parseFundTradeHistory(headers: string[], rows: string[][]): FundHoldingInput[] {
  type Aggregate = {
    name: string
    account_type: string | null
    units: number
    costTotal: number
    latestBasePrice: number
  }

  const aggregates = new Map<string, Aggregate>()

  rows
    .map(row => toRow(headers, row))
    .forEach(row => {
      const name = pick(row, ['ファンド名', '銘柄名', '商品名', '投資信託名', '名称'])
      if (!name) return

      const accountType = pick(row, ['口座', '口座区分', '預り区分']) || null
      const key = `${name}:${accountType ?? ''}`
      const current = aggregates.get(key) ?? {
        name,
        account_type: accountType,
        units: 0,
        costTotal: 0,
        latestBasePrice: 0,
      }
      const units = pickNumber(row, ['数量［口］', '数量[口]', '保有口数', '口数', '数量'])
      if (units <= 0) return

      const tradeType = pick(row, ['取引'])
      const amount = pickNumber(row, ['受渡金額/(ポイント利用)[円]', '受渡金額［円］', '受渡金額[円]', '受付金額[円]'])
      const basePrice = pickNumber(row, ['単価', '基準価額', '現在値'])
      if (basePrice > 0) current.latestBasePrice = basePrice

      if (/解約|売/.test(tradeType)) {
        const averageCost = current.units > 0 ? current.costTotal / current.units : 0
        current.units -= units
        current.costTotal -= averageCost * units
      } else {
        current.units += units
        current.costTotal += amount
      }

      if (current.units <= 0) {
        current.units = 0
        current.costTotal = 0
      }

      aggregates.set(key, current)
    })

  return Array.from(aggregates.values())
    .filter(item => item.units > 0)
    .map(item => {
      const averageCost = item.units > 0 ? Math.round((item.costTotal / item.units) * 10000) : 0
      return {
        name: item.name,
        account_type: item.account_type,
        units: item.units,
        average_cost: averageCost,
        base_price: item.latestBasePrice || averageCost,
        current_value: Math.round(item.costTotal),
        gain_loss: 0,
        gain_loss_rate: 0,
        broker_snapshot_at: new Date().toISOString(),
      }
    })
}

function toFund(row: CsvRow): FundHoldingInput | null {
  const name = pick(row, ['ファンド名', '銘柄名', '商品名', '投資信託名', '名称'])
  if (!name) return null

  const currentValue = pickNumber(row, ['評価額', '評価額(円)', '時価評価額', '時価評価額(円)', '評価金額'])
  const gainLoss = pickNumber(row, ['評価損益', '評価損益(円)', '損益', '損益(円)', '評価損益額'])

  return {
    name,
    account_type: pick(row, ['口座区分', '口座', '預り区分']) || null,
    units: pickNumber(row, ['保有口数', '口数', '数量']),
    average_cost: pickNumber(row, ['平均取得価額', '平均取得単価', '取得単価']),
    base_price: pickNumber(row, ['基準価額', '現在値', '現在価額']),
    current_value: currentValue,
    gain_loss: gainLoss,
    gain_loss_rate: pickPercent(row, ['評価損益率', '評価損益率(%)', '損益率', '損益率(%)']),
    broker_snapshot_at: new Date().toISOString(),
  }
}

function toFundTransaction(row: CsvRow): InvestmentTransactionInput | null {
  const name = pick(row, ['ファンド名', '銘柄名', '商品名', '投資信託名', '名称'])
  if (!name) return null

  const tradeDate = toIsoDate(pick(row, ['約定日']))
  if (!tradeDate) return null

  const settlementDate = toIsoDate(pick(row, ['受渡日']))
  const tradeType = pick(row, ['取引']) || '取引'
  const quantity = pickNumber(row, ['数量［口］', '数量[口]', '口数', '数量'])
  const unitPrice = pickNumber(row, ['単価', '基準価額'])
  const amountJpy = pickNumber(row, ['受渡金額/(ポイント利用)[円]', '受渡金額［円］', '受渡金額[円]', '受付金額[円]'])

  return {
    asset_type: 'fund',
    symbol: null,
    name,
    account_type: pick(row, ['口座', '口座区分', '預り区分']) || null,
    trade_type: tradeType,
    trade_date: tradeDate,
    settlement_date: settlementDate,
    quantity,
    unit_price: unitPrice,
    amount_jpy: amountJpy,
    amount_foreign: null,
    currency: pick(row, ['決済通貨']) || 'JPY',
    fx_rate: null,
    source: 'rakuten_fund_tradehistory',
    external_id: [
      'rakuten-fund',
      tradeDate,
      settlementDate,
      name,
      tradeType,
      quantity,
      unitPrice,
      amountJpy,
    ].join(':'),
  }
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
  const withoutPointNote = value.replace(/\(.+\)/g, '')
  const normalized = withoutPointNote.replace(/[,"%円口+％\s]/g, '').replace(/△/g, '-')
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
