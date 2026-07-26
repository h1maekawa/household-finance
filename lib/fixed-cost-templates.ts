// lib/fixed-cost-templates.ts
//
// 初期設定で提示する固定費テンプレート(要件書 §16)。
// チェックを入れた項目だけを scheduled_payments へ一括登録する。
// 金額・支払日・引落口座はユーザーが埋めるので、ここでは「よくある初期値」だけ持つ。

export type FixedCostTemplateItem = {
  /** そのまま scheduled_payments.name になる */
  name: string
  category: string
  /** 初期表示の支払日。ユーザーが変更できる */
  defaultDueDay: number
  /** 既定でチェックを入れるか(ほぼ全員が契約しているもの) */
  defaultChecked?: boolean
  /** 支払日が土日祝のとき翌営業日へずらすのが既定か(銀行引落は基本ずれる) */
  defaultBusinessDayRule?: 'none' | 'next'
}

export type FixedCostTemplateGroup = {
  key: string
  label: string
  items: FixedCostTemplateItem[]
}

export const FIXED_COST_TEMPLATES: FixedCostTemplateGroup[] = [
  {
    key: 'housing',
    label: '住居',
    items: [
      { name: '家賃', category: '住居費', defaultDueDay: 26, defaultChecked: true, defaultBusinessDayRule: 'next' },
      { name: '駐車場', category: '住居費', defaultDueDay: 26, defaultBusinessDayRule: 'next' },
    ],
  },
  {
    key: 'utilities',
    label: '光熱費',
    items: [
      { name: '電気', category: '水道光熱費', defaultDueDay: 27, defaultChecked: true, defaultBusinessDayRule: 'next' },
      { name: 'ガス', category: '水道光熱費', defaultDueDay: 27, defaultBusinessDayRule: 'next' },
      { name: '水道', category: '水道光熱費', defaultDueDay: 27, defaultChecked: true, defaultBusinessDayRule: 'next' },
    ],
  },
  {
    key: 'telecom',
    label: '通信',
    items: [
      { name: '携帯電話', category: '通信費', defaultDueDay: 27, defaultChecked: true },
      { name: '光回線', category: '通信費', defaultDueDay: 27 },
    ],
  },
  {
    key: 'insurance',
    label: '保険',
    items: [
      { name: '生命保険', category: '保険', defaultDueDay: 27, defaultChecked: true, defaultBusinessDayRule: 'next' },
      { name: '医療保険', category: '保険', defaultDueDay: 27, defaultBusinessDayRule: 'next' },
      { name: '自動車保険', category: '保険', defaultDueDay: 27, defaultBusinessDayRule: 'next' },
    ],
  },
  {
    key: 'subscription',
    label: 'サブスク',
    items: [
      { name: 'Apple Music', category: 'サブスク', defaultDueDay: 1, defaultChecked: true },
      { name: 'ChatGPT', category: 'サブスク', defaultDueDay: 1 },
      { name: 'Claude', category: 'サブスク', defaultDueDay: 1 },
      { name: 'Gemini', category: 'サブスク', defaultDueDay: 1 },
      { name: 'Netflix', category: 'サブスク', defaultDueDay: 1 },
      { name: 'Amazon Prime', category: 'サブスク', defaultDueDay: 1 },
      { name: 'Spotify', category: 'サブスク', defaultDueDay: 1 },
      { name: 'iCloud', category: 'サブスク', defaultDueDay: 1 },
      { name: 'Google One', category: 'サブスク', defaultDueDay: 1 },
      { name: 'GitHub Copilot', category: 'サブスク', defaultDueDay: 1 },
      { name: 'Cursor', category: 'サブスク', defaultDueDay: 1 },
      { name: 'Vercel', category: 'サブスク', defaultDueDay: 1 },
      { name: 'Supabase', category: 'サブスク', defaultDueDay: 1 },
    ],
  },
]

/** テンプレート名 → 定義。API 側の検証に使う */
export const TEMPLATE_ITEMS_BY_NAME = new Map(
  FIXED_COST_TEMPLATES.flatMap(group => group.items.map(item => [item.name, item] as const))
)
