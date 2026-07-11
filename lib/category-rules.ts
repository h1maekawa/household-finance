import { CATEGORIES, INCOME_CATEGORIES, Kind, Transaction } from '@/types/transaction'

export type MerchantRule = {
  id?: string
  merchant_pattern: string
  category: string
  payment_method?: string | null
  confidence?: number
}

type CategoryDecision = {
  category: string
  needsReview: boolean
  reviewReason: string | null
  matchedRule?: string
}

export const DEFAULT_MERCHANT_RULES: MerchantRule[] = [
  { merchant_pattern: '楽天モバイル', category: '通信費' },
  { merchant_pattern: 'モバイル通信料', category: '通信費' },
  { merchant_pattern: '電気', category: '水道光熱費' },
  { merchant_pattern: 'ガス', category: '水道光熱費' },
  { merchant_pattern: '水道', category: '水道光熱費' },
  { merchant_pattern: '東京電力', category: '水道光熱費' },
  { merchant_pattern: '東京ガス', category: '水道光熱費' },
  { merchant_pattern: 'ヤチン', category: '住居費' },
  { merchant_pattern: '家賃', category: '住居費' },
  { merchant_pattern: 'MHF', category: '住居費' },
  { merchant_pattern: 'ジブラルタ', category: '保険' },
  { merchant_pattern: 'PGBS/ジブラルタ', category: '保険' },
  { merchant_pattern: '楽天証券', category: '投資' },
  { merchant_pattern: '投信積立', category: '投資' },
  { merchant_pattern: 'PASMO', category: '交通費' },
  { merchant_pattern: 'SUICA', category: '交通費' },
  { merchant_pattern: '京王電鉄定期券', category: '交通費' },
  { merchant_pattern: '国際自動車', category: '交通費' },
  { merchant_pattern: 'コクサイジドウシヤ', category: '交通費' },
  { merchant_pattern: 'LUUP', category: '交通費' },
  { merchant_pattern: 'ライフコーポレーション', category: '食費' },
  { merchant_pattern: 'サミット', category: '食費' },
  { merchant_pattern: 'TRIAL', category: '食費' },
  { merchant_pattern: 'セブン-イレブン', category: '日用品' },
  { merchant_pattern: 'ローソン', category: '日用品' },
  { merchant_pattern: 'ファミリーマート', category: '日用品' },
  { merchant_pattern: 'MINISTOP', category: '日用品' },
  { merchant_pattern: 'ミニストップ', category: '日用品' },
  { merchant_pattern: 'ミニストツプ', category: '日用品' },
  { merchant_pattern: 'KOKUMIN', category: '日用品' },
  { merchant_pattern: 'ミネドラッグ', category: '日用品' },
  { merchant_pattern: 'ミネドラツグ', category: '日用品' },
  { merchant_pattern: 'ドトール', category: '外食' },
  { merchant_pattern: 'スターバックス', category: '外食' },
  { merchant_pattern: '吉野家', category: '外食' },
  { merchant_pattern: 'すき家', category: '外食' },
  { merchant_pattern: 'サイゼリヤ', category: '外食' },
  { merchant_pattern: '鳥メロ', category: '外食' },
  { merchant_pattern: '餃子酒場', category: '外食' },
  { merchant_pattern: 'SAKURAGYOZA', category: '外食' },
  { merchant_pattern: 'NAKAMICHIMYOZA', category: '外食' },
  { merchant_pattern: 'カラオケ', category: '娯楽' },
  { merchant_pattern: 'まねきねこ', category: '娯楽' },
  { merchant_pattern: '歌広場', category: '娯楽' },
  { merchant_pattern: 'オリエンタルラウンジ', category: '娯楽' },
]

function normalizeText(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[()\[\]（）【】「」『』]/g, '')
    .replace(/[\s　:_/・.*-]/g, '')
}

export function extractMerchantText(value: string) {
  const normalized = value.normalize('NFKC')
  const parenMatch = normalized.match(/自動連携\s*\(([^)]+)\)/)
  if (parenMatch?.[1]) return parenMatch[1].trim()
  return normalized
}

function validCategory(category: string, kind: Kind) {
  const list = kind === 'income' ? INCOME_CATEGORIES : CATEGORIES
  return (list.map(c => c.name) as string[]).includes(category)
}

export function decideCategory(input: {
  merchantText: string
  kind?: Kind
  currentCategory?: string
  rules?: MerchantRule[]
}): CategoryDecision {
  const kind = input.kind ?? 'expense'
  const currentCategory = input.currentCategory || (kind === 'income' ? 'その他収入' : 'その他')
  const merchantText = extractMerchantText(input.merchantText)
  const normalizedMerchant = normalizeText(merchantText)
  const rules = [...(input.rules ?? []), ...DEFAULT_MERCHANT_RULES]

  for (const rule of rules) {
    if (!validCategory(rule.category, kind)) continue
    const pattern = normalizeText(rule.merchant_pattern)
    if (!pattern) continue
    if (normalizedMerchant.includes(pattern)) {
      return {
        category: rule.category,
        needsReview: false,
        reviewReason: null,
        matchedRule: rule.merchant_pattern,
      }
    }
  }

  if (validCategory(currentCategory, kind) && currentCategory !== 'その他') {
    return { category: currentCategory, needsReview: false, reviewReason: null }
  }

  return {
    category: currentCategory,
    needsReview: kind === 'expense',
    reviewReason: kind === 'expense' ? `分類確認: ${merchantText}` : null,
  }
}

export function decideTransactionCategory(transaction: Transaction, rules: MerchantRule[] = []) {
  return decideCategory({
    merchantText: `${transaction.memo ?? ''} ${transaction.category}`,
    kind: transaction.kind ?? 'expense',
    currentCategory: transaction.category,
    rules,
  })
}
