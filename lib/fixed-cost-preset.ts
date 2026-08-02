// lib/fixed-cost-preset.ts
//
// 「現在の固定費を一括登録」で投入する定期支出の定義。
//
// ユーザーIDを埋め込んだマイグレーションは作らない。ログイン中のユーザーが
// 画面から登録し、カード名・口座名はサーバー側で ID へ解決する。
//
// 支払日・引落口座が分からない項目は、ここでは埋めない。推測した日付を入れると
// キャッシュフローが「それらしいが間違っている」状態になり、
// 未設定として警告が出るより検知しにくくなるため。
import type { AmountType, BusinessDayRule, PaymentMethod } from '@/types/cashflow'

export type FixedCostPresetItem = {
  name: string
  amount: number
  category: string
  amountType: AmountType
  paymentMethod: PaymentMethod
  /** カード払いのとき、紐づけるカードの表示名。サーバー側で ID へ解決する */
  cardName?: string
  /** 口座引落のとき、引落口座の表示名。サーバー側で ID へ解決する */
  accountName?: string
  /** 支払日。分からない項目は null のままにして「確認が必要」を出す */
  dueDay: number | null
  /**
   * 支払日が土日祝のときの補正。
   * 銀行引落は翌営業日にずれるのが一般的だが、契約によって前営業日のこともあるので
   * 既定では補正しない。ユーザーが確認できた項目にだけ 'next' を入れる。
   */
  businessDayRule?: BusinessDayRule
  /**
   * カード利用メールとの照合キーワード。
   * 実際に届いている摘要から取ったものだけを入れる。
   * これが空だと、実カード利用と固定費の予測が二重計上される。
   */
  matchKeywords: string[]
  /** 画面に出す補足 */
  note?: string
}

/**
 * 積立投資のカテゴリ。生活固定費と分けて集計するため、
 * lib/services/money-plan.ts の判定と同じ '投資' を使う。
 */
export const FIXED_COST_PRESET: FixedCostPresetItem[] = [
  {
    name: '家賃',
    amount: 58330,
    category: '住居費',
    amountType: 'fixed',
    paymentMethod: 'bank_debit',
    accountName: '三井住友銀行',
    dueDay: 26,
    // 26日が土日祝なら翌営業日（例: 2026-09-26は土曜 → 9/28に引き落とし）
    businessDayRule: 'next',
    matchKeywords: [],
  },
  {
    name: '保険',
    amount: 20000,
    category: '保険',
    amountType: 'variable',
    paymentMethod: 'bank_debit',
    accountName: '三井住友銀行',
    dueDay: 26,
    businessDayRule: 'next',
    matchKeywords: [],
    note: '平均額。確定額が分かったら更新してください',
  },
  {
    name: '電気代',
    amount: 2000,
    category: '水道光熱費',
    amountType: 'variable',
    paymentMethod: 'credit_card',
    cardName: '三井住友カード',
    dueDay: null,
    // 契約先はアルカナエナジー。カードの摘要はカタカナ・半角カタカナ・英字の
    // どれで来るか実物を見るまで確定しないので、表記ゆれをまとめて登録する。
    // 照合は NFKC 正規化後の部分一致なので、半角カタカナは自動で吸収される。
    matchKeywords: ['アルカナエナジー', 'アルカナ', 'ARCANA'],
    note: 'アルカナエナジー。初回請求後に照合できているか確認してください',
  },
  {
    name: 'ガス代',
    amount: 1600,
    category: '水道光熱費',
    amountType: 'variable',
    paymentMethod: 'credit_card',
    cardName: '三井住友カード',
    dueDay: null,
    // 契約先は東京ガス。カード明細は「トウキヨウガス」のように
    // 拗音が大書きのカタカナで来ることがあるため、その形も入れておく。
    // 単に 'ガス' だけにすると無関係な店名を誤照合するので使わない。
    matchKeywords: ['東京ガス', 'トウキヨウガス', 'トウキョウガス', 'TOKYO GAS'],
    note: '東京ガス。初回請求後に照合できているか確認してください',
  },
  {
    name: '水道代',
    amount: 1500,
    category: '水道光熱費',
    amountType: 'variable',
    paymentMethod: 'credit_card',
    cardName: '楽天カード',
    dueDay: null,
    // 実際に届いている摘要「26/06-26/07スイドウリ」から取得
    matchKeywords: ['スイドウリ'],
  },
  {
    name: '楽天モバイル',
    amount: 3980,
    category: '通信費',
    amountType: 'fixed',
    paymentMethod: 'credit_card',
    cardName: '楽天カード',
    dueDay: null,
    matchKeywords: ['楽天モバイル', 'RAKUTEN MOBILE', 'モバイル通信料'],
  },
  {
    name: '交通費・定期代',
    amount: 13940,
    category: '交通費',
    amountType: 'fixed',
    paymentMethod: 'credit_card',
    cardName: '三井住友カード',
    dueDay: null,
    // 実際に届いている摘要「京王電鉄定期券(モバイル)」から取得
    matchKeywords: ['京王電鉄定期券'],
  },
  {
    name: '積立NISA',
    amount: 15000,
    category: '投資',
    amountType: 'variable',
    paymentMethod: 'credit_card',
    cardName: '楽天カード',
    dueDay: null,
    matchKeywords: ['楽天証券', 'RAKUTEN SECURITIES', '投信積立'],
    note: '生活固定費とは分けて「投資」として集計します',
  },
]

/** 生活固定費（積立投資を除く）の合計 */
export function presetLivingFixedTotal(items = FIXED_COST_PRESET) {
  return items
    .filter(item => item.category !== '投資')
    .reduce((sum, item) => sum + item.amount, 0)
}

/** 毎月の積立投資の合計 */
export function presetInvestmentTotal(items = FIXED_COST_PRESET) {
  return items
    .filter(item => item.category === '投資')
    .reduce((sum, item) => sum + item.amount, 0)
}

/** 固定支出合計 = 生活固定費 + 積立投資 */
export function presetTotal(items = FIXED_COST_PRESET) {
  return presetLivingFixedTotal(items) + presetInvestmentTotal(items)
}

/**
 * 重複判定のキー。名前だけで見ると「楽天カード払いの水道代」と
 * 「口座引落の水道代」が同じ扱いになってしまうため、支払方法とカードも含める。
 */
export function fixedCostIdentity(input: {
  name: string
  paymentMethod?: string | null
  cardId?: string | null
}) {
  const name = input.name.normalize('NFKC').toLowerCase().replace(/[\s　]/g, '')
  return `${name}|${input.paymentMethod ?? 'bank_debit'}|${input.cardId ?? ''}`
}
