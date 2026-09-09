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
 * - 計算は純関数。同じ入力なら必ず同じ額になる（AIに金額を作らせない）。
 *   算出時刻はここで作らず、I/O境界（APIルート）で付ける
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
  /** 防衛資金の不足額。最優先で確保する。不明なら0 */
  reserveGap?: number
  /** 毎月の貯蓄目標（budget.savings.target）。ここで再計算しない */
  savingsTarget?: number
  /** 毎月の投資目標（budget.investment.target）。ここで再計算しない */
  investmentTarget?: number
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
  /** 投資に回せる額。算出不能なら null。後方互換のため名前を変えない */
  investable_amount: number | null
  /**
   * 再配分できる現金の総額。investable_amount と同じ原資の別名。
   * allocation の4つはこれを分け合う（別々の財布ではない）。
   */
  allocatable_cash: number | null
  /**
   * 原資の配分。「上限いくらまで使える」という capacity ではなく、
   * 「今月いくらをどこへ充てるか」という allocation。
   * 4つの合計は必ず max(allocatable_cash, 0) と一致する。
   */
  allocation: {
    /** 手元の現金から防衛資金として確保する額。毎月の積立ではない */
    emergency_fund: number | null
    /** 通常の貯金へ配分する額（budget.savings.target が上限） */
    savings: number | null
    /** 資産形成へ配分する額（budget.investment.target が上限） */
    asset_building: number | null
    /** どこにも配分していない余力。必ず0以上 */
    unallocated_cash: number | null
  }
  data_freshness: 'current' | 'stale' | 'unknown'
  confidence: 'high' | 'medium' | 'low'
  missing_data: string[]
  /** 内訳の説明（UIでそのまま出せる） */
  breakdown: { label: string; amount: number; sign: '+' | '-' }[]
}

function yen(value: number): number {
  return Math.round(Number.isFinite(value) ? value : 0)
}

/**
 * 同じ原資を順に配分する。3つを別々の財布として扱わないための関数。
 *
 *   防衛資金の補充 → 貯蓄目標 → 投資目標 → 残り(自由)
 *
 * 防衛資金が不足しているときに資産形成へ全額回らないのは、この順序による。
 * 合計は必ず配分原資と一致する（超えない）。
 */
function allocate(
  pool: number,
  reserveGap: number,
  savingsTarget: number,
  investmentTarget: number
): { emergencyFund: number; savings: number; assetBuilding: number; unallocated: number } {
  let rest = Math.max(pool, 0)

  // 手元の現金の振り替え。毎月の積立とは意味が違うので通常貯金と分けて出す
  const emergencyFund = Math.min(rest, Math.max(yen(reserveGap), 0))
  rest -= emergencyFund

  const savings = Math.min(rest, Math.max(yen(savingsTarget), 0))
  rest -= savings

  const assetBuilding = Math.min(rest, Math.max(yen(investmentTarget), 0))
  rest -= assetBuilding

  return { emergencyFund, savings, assetBuilding, unallocated: rest }
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

  // 口座残高が分からない間は配分も出さない。0円と「分からない」を混同しない
  const allocation =
    investable === null
      ? null
      : allocate(
          investable,
          input.reserveGap ?? 0,
          input.savingsTarget ?? 0,
          input.investmentTarget ?? 0
        )

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
    allocatable_cash: investable,
    allocation: {
      emergency_fund: allocation?.emergencyFund ?? null,
      savings: allocation?.savings ?? null,
      asset_building: allocation?.assetBuilding ?? null,
      unallocated_cash: allocation?.unallocated ?? null,
    },
    data_freshness: input.availableCash === null ? 'unknown' : 'current',
    confidence,
    missing_data: missing,
    breakdown,
  }
}
