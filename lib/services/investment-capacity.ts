/**
 * 当月の投資可能額の算出。
 *
 * docs/investment/flow_plus_ai_company_integration_spec.md の基本式:
 *   投資可能額
 *   = 現在利用できる個人資金 + 次回入金予定
 *   - 未引落しカード利用額 - 固定費・予定支出
 *   - 個人生活用として残す金額 - 当月すでに投資した金額
 *
 * 方針:
 * - 計算は純関数。同じ入力なら必ず同じ額になる（AIに金額を作らせない）
 * - 欠けている入力は 0 で埋めず missing_data に記録し、confidence を下げる
 * - 生活費を削って投資に回す提案はしない。残り生活費は必ず差し引く
 */

export type CapacityInput = {
  month: string // YYYY-MM
  /** 口座残高の合計。未登録なら null */
  availableCash: number | null
  /** 今月これから入る見込みの収入（planned - actual、マイナスなら0） */
  expectedIncome: number
  /** 今月すでに確定した収入 */
  confirmedIncome: number
  /** 今月すでに使った変動費 */
  confirmedExpenses: number
  /** 未引落のカード請求額 */
  pendingCardAmount: number
  /** 今月まだ払っていない固定費 */
  fixedExpenses: number
  /** 固定費以外の予定支出（引落予定など） */
  scheduledExpenses: number
  /** 今月の残り生活費（ここは投資に回さない） */
  livingReserve: number
  /** 予備費として確保する額 */
  buffer: number
  /** 今月すでに投資した額 */
  alreadyInvested: number
  /** 欠けている入力の説明 */
  missingData: string[]
}

export type CapacityResult = {
  target_month: string
  available_cash: number | null
  confirmed_income: number
  expected_income: number
  confirmed_expenses: number
  pending_card_amount: number
  fixed_expenses: number
  scheduled_expenses: number
  already_invested: number
  personal_cash_floor: number
  /** 投資に回せる額。算出不能なら null */
  investable_amount: number | null
  calculated_at: string
  data_freshness: 'current' | 'stale' | 'unknown'
  confidence: 'high' | 'medium' | 'low'
  missing_data: string[]
  /** 内訳の説明（UIでそのまま出せる） */
  breakdown: { label: string; amount: number; sign: '+' | '-' }[]
}

function yen(value: number): number {
  return Math.round(Number.isFinite(value) ? value : 0)
}

export function computeInvestmentCapacity(input: CapacityInput): CapacityResult {
  const missing = [...input.missingData]

  // 生活のために残す額。ここを削ってまで投資はしない
  const personalCashFloor = yen(input.livingReserve + input.buffer)

  const deductions =
    yen(input.pendingCardAmount) +
    yen(input.fixedExpenses) +
    yen(input.scheduledExpenses) +
    personalCashFloor +
    yen(input.alreadyInvested)

  // 口座残高が分からないと投資余力は出せない（推定で埋めない）
  const investable =
    input.availableCash === null
      ? null
      : yen(input.availableCash) + yen(input.expectedIncome) - deductions

  // 入力の欠けが多いほど信頼度を下げる
  const confidence: CapacityResult['confidence'] =
    input.availableCash === null || missing.length >= 3
      ? 'low'
      : missing.length > 0
        ? 'medium'
        : 'high'

  const breakdown: CapacityResult['breakdown'] = ([
    { label: '口座残高', amount: yen(input.availableCash ?? 0), sign: '+' },
    { label: '今月の入金予定', amount: yen(input.expectedIncome), sign: '+' },
    { label: '未引落のカード請求', amount: yen(input.pendingCardAmount), sign: '-' },
    { label: '未払いの固定費', amount: yen(input.fixedExpenses), sign: '-' },
    { label: 'その他の引落予定', amount: yen(input.scheduledExpenses), sign: '-' },
    { label: '今月の残り生活費', amount: yen(input.livingReserve), sign: '-' },
    { label: '予備費', amount: yen(input.buffer), sign: '-' },
    { label: '今月すでに投資した額', amount: yen(input.alreadyInvested), sign: '-' },
  ] as CapacityResult['breakdown']).filter(row => row.amount !== 0)

  return {
    target_month: input.month,
    available_cash: input.availableCash === null ? null : yen(input.availableCash),
    confirmed_income: yen(input.confirmedIncome),
    expected_income: yen(input.expectedIncome),
    confirmed_expenses: yen(input.confirmedExpenses),
    pending_card_amount: yen(input.pendingCardAmount),
    fixed_expenses: yen(input.fixedExpenses),
    scheduled_expenses: yen(input.scheduledExpenses),
    already_invested: yen(input.alreadyInvested),
    personal_cash_floor: personalCashFloor,
    investable_amount: investable,
    calculated_at: new Date().toISOString(),
    data_freshness: input.availableCash === null ? 'unknown' : 'current',
    confidence,
    missing_data: missing,
    breakdown,
  }
}
