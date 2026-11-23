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
  /** 今月の買付の合計（記録日に関係なく分かる実績。表示用） */
  alreadyInvested: number
  /**
   * 投資に関して実際に差し引く額（残高未反映の買付＋積立の引落を1回ずつ）。
   * 不明なら null。未指定なら alreadyInvested を差し引く
   */
  investmentDeducted?: number | null
  /**
   * 必要な防衛資金（必須生活費 × 月数）。算出できないなら null（0円で埋めない）。
   * 防衛資金は流動口座の現金そのものなので、原資とは別の「確保済み」として数えない。
   * 原資から先に min(原資, requiredReserve) を確保する。
   */
  requiredReserve: number | null
  /** 毎月の貯蓄目標（budget.savings.target）。ここで再計算しない */
  savingsTarget?: number
  /** 毎月の投資目標（budget.investment.target）。ここで再計算しない */
  investmentTarget?: number
  /** 欠けている入力の説明 */
  missingData: string[]
  /** 最も古い口座の残高記録時刻。鮮度判定に使う。未登録なら null */
  balanceOldestRecordedAt: string | null
  /** 口座ごとの記録時刻（任意）。stale な口座数の算出に使う */
  balanceAccounts?: { accountId: string; recordedAt: string | null }[]
  /** 鮮度判定の基準時刻。純関数内で時刻を作らないため、I/O境界で渡す */
  now: Date
}

/** 残高の最終更新からこの時間を超えたら stale（7日） */
export const BALANCE_STALE_HOURS = 168

export function judgeBalanceFreshness(input: {
  oldestRecordedAt: string | null
  accountCount: number
  now: Date
  accounts?: { accountId: string; recordedAt: string | null }[]
}): { freshness: 'current' | 'stale' | 'unknown'; staleAccountIds: string[] } {
  if (!input.oldestRecordedAt) return { freshness: 'unknown', staleAccountIds: [] }
  const oldest = Date.parse(input.oldestRecordedAt)
  if (!Number.isFinite(oldest)) return { freshness: 'unknown', staleAccountIds: [] }

  const limitMs = BALANCE_STALE_HOURS * 3600_000
  const isStale = (iso: string | null) => {
    const t = iso ? Date.parse(iso) : NaN
    return Number.isFinite(t) && input.now.getTime() - t > limitMs
  }
  if (input.now.getTime() - oldest <= limitMs) return { freshness: 'current', staleAccountIds: [] }
  return {
    freshness: 'stale',
    staleAccountIds: (input.accounts ?? []).filter(a => isStale(a.recordedAt)).map(a => a.accountId),
  }
}

export type CapacityEmergencyFundStatus = 'funded' | 'underfunded' | 'unknown'

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
  /** 投資に関して実際に差し引いた額。残高の記録日が不明なら null */
  already_invested_deducted: number | null
  personal_cash_floor: number
  /** 投資に回せる額。算出不能なら null。後方互換のため名前を変えない */
  investable_amount: number | null
  /**
   * 再配分できる現金の総額。investable_amount と同じ原資の別名。
   * allocation の4つはこれを分け合う（別々の財布ではない）。
   */
  allocatable_cash: number | null
  /** 必要な防衛資金。必須生活費が不明なら null */
  required_reserve: number | null
  /** 原資 ≥ required_reserve なら funded、未満なら underfunded、不明なら unknown */
  emergency_fund_status: CapacityEmergencyFundStatus
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
  /** 最も古い口座の残高記録時刻 */
  balance_oldest_recorded_at: string | null
  /** 7日を超えて更新されていない口座の数 */
  stale_account_count: number
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
 *   防衛資金の確保 → 貯蓄目標 → 投資目標 → 残り(自由)
 *
 * 防衛資金が不足しているときに資産形成へ全額回らないのは、この順序による。
 * 合計は必ず配分原資と一致する（超えない）。
 */
function allocate(
  pool: number,
  requiredReserve: number,
  savingsTarget: number,
  investmentTarget: number
): { emergencyFund: number; savings: number; assetBuilding: number; unallocated: number } {
  let rest = Math.max(pool, 0)

  // 防衛資金は原資と同じ流動口座の現金。原資から先に確保し、残りを分ける
  // （総残高を「確保済み」と数えると同じ1円が防衛資金と投資の両方に使われる）
  const emergencyFund = Math.min(rest, Math.max(yen(requiredReserve), 0))
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

  const investmentDeducted =
    input.investmentDeducted === undefined ? input.alreadyInvested : input.investmentDeducted
  const investmentDeduction = investmentDeducted === null ? 0 : yen(investmentDeducted)

  const deductions =
    yen(input.pendingCardAmount) +
    yen(input.fixedExpenses) +
    yen(input.scheduledExpenses) +
    personalCashFloor +
    investmentDeduction

  // 口座残高が分からないと投資余力は出せない（推定で埋めない）
  const investable =
    input.availableCash === null
      ? null
      : yen(input.availableCash) + yen(input.expectedIncome) - deductions

  // 口座残高または必要な防衛資金が分からない間は配分も出さない。
  // 0円と「分からない」を混同しない
  const requiredReserve = input.requiredReserve === null ? null : Math.max(yen(input.requiredReserve), 0)
  if (requiredReserve === null) missing.push('生活防衛資金の必要額を算出できません')
  const allocation =
    investable === null || requiredReserve === null
      ? null
      : allocate(
          investable,
          requiredReserve,
          input.savingsTarget ?? 0,
          input.investmentTarget ?? 0
        )

  const emergencyFundStatus: CapacityEmergencyFundStatus =
    investable === null || requiredReserve === null
      ? 'unknown'
      : Math.max(investable, 0) >= requiredReserve
        ? 'funded'
        : 'underfunded'

  const freshness =
    input.availableCash === null
      ? { freshness: 'unknown' as const, staleAccountIds: [] as string[] }
      : judgeBalanceFreshness({
          oldestRecordedAt: input.balanceOldestRecordedAt,
          accountCount: input.balanceAccounts?.length ?? 0,
          now: input.now,
          accounts: input.balanceAccounts,
        })
  const isStale = freshness.freshness === 'stale'
  if (isStale) missing.push('7日以上更新されていない口座残高があります')

  // 入力の欠けが多いほど信頼度を下げる
  const confidence: CapacityResult['confidence'] =
    input.availableCash === null || isStale || missing.length >= 3
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
    { label: '今月すでに投資した額', amount: investmentDeduction, sign: '-' },
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
    already_invested_deducted: investmentDeducted === null ? null : investmentDeduction,
    personal_cash_floor: personalCashFloor,
    investable_amount: investable,
    allocatable_cash: investable,
    required_reserve: requiredReserve,
    emergency_fund_status: emergencyFundStatus,
    allocation: {
      emergency_fund: allocation?.emergencyFund ?? null,
      savings: allocation?.savings ?? null,
      asset_building: allocation?.assetBuilding ?? null,
      unallocated_cash: allocation?.unallocated ?? null,
    },
    data_freshness: freshness.freshness,
    balance_oldest_recorded_at: input.balanceOldestRecordedAt,
    stale_account_count: isStale ? Math.max(freshness.staleAccountIds.length, 1) : 0,
    confidence,
    missing_data: missing,
    breakdown,
  }
}
