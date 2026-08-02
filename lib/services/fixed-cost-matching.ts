// lib/services/fixed-cost-matching.ts
//
// カード払いの固定費と、実際に取り込まれたカード利用を突き合わせる。
//
// なぜ必要か:
//   カード払いの固定費は「そのうちカード利用が発生する」という予測にすぎない。
//   ところが Gmail 取り込みは実際のカード利用を transactions に入れ、それは
//   buildGeneratedCreditPayments が同じカード請求に合算する。両方を足すと
//   同じ支出が二重にキャッシュフローから引かれる。
//   実データでは 楽天モバイル・積立NISA・水道代・交通費の4件が該当し、
//   月あたり約31,000円ぶん多く引かれていた。
//
// 原則は「実績が予測に勝つ」:
//   締めサイクル内に照合できる実取引があれば、その固定費の予測は加算しない。
//   確定請求額が見込みを置き換えるのと同じ考え方。
//
// 照合はユーザーが登録したキーワードだけで行う。摘要から推測して自動で
// キーワードを作らない。誤照合は「実際には払っているのに予測から消える」
// という、二重計上より気づきにくい壊れ方をするため。
import type { CreditCardSetting, ScheduledPayment } from '@/types/cashflow'
import type { Transaction } from '@/types/transaction'
import { resolveCardCycle } from '@/lib/cashflow'

/** 固定費1件 × 締めサイクル1つ ぶんの照合結果 */
export type FixedCostMatch = {
  paymentId: string
  paymentName: string
  /** 一致した取引の合計額（＝その月の確定額） */
  amount: number
  /** 一致した取引が属する締めサイクルの引き落とし日 */
  paymentDate: string
  /** 一致した取引の利用月 'YYYY-MM' */
  month: string
  transactionIds: string[]
}

/** 全角半角・大文字小文字・記号の揺れを吸収する（'ﾗｸﾃﾝ' と '楽天' を同一視する） */
function normalize(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　()（）:：*/.,-]/g, '')
}

function matchesKeywords(memo: string | null | undefined, keywords: string[]) {
  if (keywords.length === 0) return false
  const haystack = normalize(memo ?? '')
  if (!haystack) return false
  return keywords.some(keyword => {
    const needle = normalize(keyword)
    return needle.length > 0 && haystack.includes(needle)
  })
}

function cardMatches(tx: Transaction, card: CreditCardSetting) {
  const target = normalize(card.name)
  const issuer = normalize(tx.card_issuer ?? '')
  const method = normalize(tx.payment_method ?? '')
  if (!target) return false
  return (
    issuer === target ||
    method === target ||
    (issuer.length > 0 && (target.includes(issuer) || issuer.includes(target)))
  )
}

/**
 * カード払いの固定費それぞれについて、照合できた実取引を締めサイクル単位でまとめる。
 *
 * キーワード未設定の固定費は一切照合しない（＝予測がそのまま残る）。
 * 実取引が来ているのにキーワードが無い固定費は二重計上になるため、
 * 呼び出し側は findUnmatchedCardFixedCosts で警告を出すこと。
 */
export function matchFixedCostsToCardUsage(
  payments: ScheduledPayment[],
  cards: CreditCardSetting[],
  transactions: Transaction[]
): FixedCostMatch[] {
  const cardsById = new Map(cards.map(card => [card.id, card]))
  const matches = new Map<string, FixedCostMatch>()

  for (const payment of payments) {
    if (!payment.is_active) continue
    if (payment.payment_method !== 'credit_card' || !payment.credit_card_id) continue
    const keywords = payment.match_keywords ?? []
    if (keywords.length === 0) continue

    const card = cardsById.get(payment.credit_card_id)
    if (!card) continue

    for (const tx of transactions) {
      if (tx.kind === 'income') continue
      if (!cardMatches(tx, card)) continue
      if (!matchesKeywords(tx.memo, keywords)) continue

      const cycle = resolveCardCycle(new Date(`${tx.date}T00:00:00`), card, tx.memo)
      if (!cycle) continue

      const key = `${payment.id}|${cycle.paymentDate}`
      const existing = matches.get(key)
      if (existing) {
        existing.amount += tx.amount
        existing.transactionIds.push(tx.id)
        continue
      }
      matches.set(key, {
        paymentId: payment.id,
        paymentName: payment.name,
        amount: tx.amount,
        paymentDate: cycle.paymentDate,
        month: tx.date.slice(0, 7),
        transactionIds: [tx.id],
      })
    }
  }

  return [...matches.values()].sort((a, b) =>
    a.paymentDate === b.paymentDate ? a.paymentName.localeCompare(b.paymentName) : a.paymentDate < b.paymentDate ? -1 : 1
  )
}

/**
 * 予測から取り下げるべき「固定費 × 引き落とし日」の集合。
 * projectCashflow に渡すと、その日のその固定費は残高から引かれなくなる
 * （実取引ぶんがカード請求として既に引かれているため）。
 */
export function suppressedDebitKeys(matches: FixedCostMatch[]): Set<string> {
  return new Set(matches.map(match => `${match.paymentId}|${match.paymentDate}`))
}

/** 照合結果を「固定費ID|利用月 → 確定額」に畳む。変動固定費の確定額として使う */
export function confirmedAmountsByMonth(matches: FixedCostMatch[]): Map<string, number> {
  const index = new Map<string, number>()
  for (const match of matches) {
    const key = `${match.paymentId}|${match.month}`
    index.set(key, (index.get(key) ?? 0) + match.amount)
  }
  return index
}

/** 照合キーワードが無いカード払い固定費。実取引と二重計上している可能性がある */
export function findUnmatchedCardFixedCosts(payments: ScheduledPayment[]): ScheduledPayment[] {
  return payments.filter(
    payment =>
      payment.is_active &&
      payment.payment_method === 'credit_card' &&
      Boolean(payment.credit_card_id) &&
      (payment.match_keywords ?? []).length === 0
  )
}
