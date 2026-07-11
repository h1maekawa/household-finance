// lib/card-payment-rules.ts
// カード種別ごとの締め日・支払日ルール定義と、利用日→支払予定日の算出ロジック。

import { nextBusinessDay } from '@/lib/holiday-jp'

// ────────────────────────────────────────────────────────────────
// 型定義
// ────────────────────────────────────────────────────────────────

export type CardType = 'rakuten' | 'smbc' | 'generic'

export type CardPlan =
  | 'rakuten_standard' // 楽天カード 通常（月末締め / 翌月27日）
  | 'rakuten_market'   // 楽天カード 楽天市場・ペイ・トラベル（25日締め / 翌月27日）
  | 'smbc_10th'        // SMBC 10日プラン（15日締め / 翌月10日）
  | 'smbc_26th'        // SMBC 26日プラン（ルール未確定のため未対応）
  | 'generic'          // ユーザー手動設定（既存 closing_day_int / payment_day_int 利用）

export interface CardPaymentRule {
  cardType: CardType
  plan: CardPlan
  /** 締め日。'end_of_month' は月末最終日を意味する */
  closingDay: number | 'end_of_month'
  /** 引き落とし日（1〜31） */
  paymentDay: number
  /** 支払月オフセット: 翌月=1, 翌々月=2 */
  paymentMonthOffset: number
  /** false の場合は calcPaymentDate() が null を返す（未対応プラン） */
  supported: boolean
  description: string
}

// ────────────────────────────────────────────────────────────────
// ルールテーブル
// ────────────────────────────────────────────────────────────────

export const CARD_PAYMENT_RULES: Record<CardPlan, CardPaymentRule> = {
  rakuten_standard: {
    cardType: 'rakuten',
    plan: 'rakuten_standard',
    closingDay: 'end_of_month', // 月末締め
    paymentDay: 27,             // 翌月27日
    paymentMonthOffset: 1,
    supported: true,
    description: '楽天カード 通常（月末締め / 翌月27日払い）',
  },
  rakuten_market: {
    cardType: 'rakuten',
    plan: 'rakuten_market',
    closingDay: 25,   // 毎月25日締め
    paymentDay: 27,   // 翌月27日払い
    paymentMonthOffset: 1,
    supported: true,
    description: '楽天カード 楽天市場/ペイ/トラベル（25日締め / 翌月27日払い）',
  },
  smbc_10th: {
    cardType: 'smbc',
    plan: 'smbc_10th',
    closingDay: 15,   // 毎月15日締め
    paymentDay: 10,   // 翌月10日払い
    paymentMonthOffset: 1,
    supported: true,
    description: '三井住友カード 10日プラン（15日締め / 翌月10日払い）',
  },
  smbc_26th: {
    cardType: 'smbc',
    plan: 'smbc_26th',
    closingDay: 15,   // 暫定値（ルール未確定）
    paymentDay: 26,
    paymentMonthOffset: 1,
    supported: false, // 26日プランのルールが確定するまで計算スキップ
    description: '三井住友カード 26日プラン（未対応）',
  },
  generic: {
    cardType: 'generic',
    plan: 'generic',
    closingDay: 31,
    paymentDay: 27,
    paymentMonthOffset: 1,
    supported: false, // generic は cashflow.ts 側の既存ロジックで処理する
    description: 'ユーザー手動設定（既存ロジックで計算）',
  },
}

// ────────────────────────────────────────────────────────────────
// 楽天市場系取引の判定
// ────────────────────────────────────────────────────────────────

const RAKUTEN_MARKET_KEYWORDS = [
  '楽天市場',
  '楽天ペイ',
  '楽天pay',
  'rakutenpay',
  '楽天トラベル',
  'rakutentravel',
]

/**
 * memo 文字列が楽天市場・楽天ペイ・楽天トラベル系かどうかを判定する。
 * 判定は小文字・スペース除去後のキーワードマッチングで行う。
 */
export function isRakutenMarketTx(memo?: string | null): boolean {
  if (!memo) return false
  const normalized = memo.toLowerCase().replace(/\s+/g, '')
  return RAKUTEN_MARKET_KEYWORDS.some(kw => normalized.includes(kw.toLowerCase()))
}

// ────────────────────────────────────────────────────────────────
// 月末日の取得
// ────────────────────────────────────────────────────────────────

function getEndOfMonth(year: number, month: number): Date {
  // month は 0-indexed (JavaScriptのDate仕様に合わせる)
  // 翌月0日 = 当月最終日
  return new Date(year, month + 1, 0)
}

function clampToMonth(year: number, month: number, day: number): Date {
  const endOfMonth = getEndOfMonth(year, month)
  const clamped = Math.min(day, endOfMonth.getDate())
  return new Date(year, month, clamped)
}

// ────────────────────────────────────────────────────────────────
// 支払予定日の算出
// ────────────────────────────────────────────────────────────────

/**
 * 利用日とカードプランから支払予定日（翌営業日補正済み）を算出する。
 *
 * - supported=false のプランは null を返す。
 * - generic プランは null を返す（既存の buildGeneratedCreditPayments ロジックで処理）。
 * - 楽天カードで memo が楽天市場系なら rakuten_market ルールを優先する。
 *
 * @param usedAt  利用日
 * @param plan    CardPlan
 * @param memo    取引メモ（楽天市場系判定に使用）
 * @returns       支払予定日（土日祝シフト済み）または null
 */
export function calcPaymentDate(
  usedAt: Date,
  plan: CardPlan,
  memo?: string | null,
): Date | null {
  // 楽天カード標準プランの場合、memo を見て楽天市場系なら rakuten_market に切り替え
  const effectivePlan: CardPlan =
    plan === 'rakuten_standard' && isRakutenMarketTx(memo)
      ? 'rakuten_market'
      : plan

  const rule = CARD_PAYMENT_RULES[effectivePlan]
  if (!rule.supported) return null

  const usedYear = usedAt.getFullYear()
  const usedMonth = usedAt.getMonth() // 0-indexed

  // 締め日の特定
  let closingDate: Date
  if (rule.closingDay === 'end_of_month') {
    closingDate = getEndOfMonth(usedYear, usedMonth)
  } else {
    closingDate = clampToMonth(usedYear, usedMonth, rule.closingDay)
  }

  // 利用日が締め日より後なら翌月サイクルの支払いになる
  const isAfterClosing = usedAt > closingDate
  const paymentCycleOffset = isAfterClosing ? rule.paymentMonthOffset + 1 : rule.paymentMonthOffset

  // 支払月を算出（月オフセット適用）
  const paymentMonthAbsolute = usedMonth + paymentCycleOffset
  const paymentYear = usedYear + Math.floor(paymentMonthAbsolute / 12)
  const paymentMonth = paymentMonthAbsolute % 12

  // 支払日を算出（月末クランプ込み）
  const rawPaymentDate = clampToMonth(paymentYear, paymentMonth, rule.paymentDay)

  // 土日祝なら翌営業日へシフト
  return nextBusinessDay(rawPaymentDate)
}
