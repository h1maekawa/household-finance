import type { AssetPlanningLoad } from './asset-planning-loader'
import type { CashflowLoad } from './cashflow-loader'
import { NO_SHORTFALL_PLAIN, noShortfallMessage, shortfallJudgeable } from './cashflow-caveat'
import { balanceDateKey } from './capacity-obligations'

export type FinanceSummary = ReturnType<typeof buildFinanceSummary>

/**
 * 既存 engine / loader の結果を外部契約へ写すだけの composition layer。
 * 金額の再計算や独自分類はここへ追加しない。
 */
export function buildFinanceSummary(input: {
  planning: AssetPlanningLoad
  cashflow: CashflowLoad
  unreviewedTransactions: number
  generatedAt: string
}) {
  const { plan, assets, budget } = input.planning
  const investment = assets.stockValue + assets.fundValue

  return {
    month: plan.month,
    generated_at: input.generatedAt,
    income: {
      planned: budget.income.planned,
      actual: budget.income.actual,
    },
    expenses: {
      fixed: budget.fixed.effective,
      variable: budget.variable.spent,
      // monthly-summary と同じ Flow+ 所有の確定集計。AI Company側で再計算させない。
      total: budget.fixed.effective + budget.variable.spent,
    },
    cashflow: {
      free_to_spend: plan.cashflow.freeToSpend,
      daily_allowance: plan.cashflow.dailyAllowance,
    },
    capacity: {
      saving: plan.allocation.savings,
      asset_building: plan.allocation.assetBuilding,
      free_cash: plan.allocation.unallocatedCash,
    },
    assets: {
      cash: assets.liquidCash,
      investment,
      other: assets.otherAssets,
      total: assets.totalAssets,
      recorded_at: assets.recordedAt,
    },
    review: {
      unreviewed_transactions: input.unreviewedTransactions,
      unassigned_card_usage: input.cashflow.unassignedCardUsage?.count ?? 0,
      // 開始残高が未登録のときは予測が空になる。false を「リスクなし」と読ませないため、
      // 判定できたかどうかを negative_balance_risk_known で別に返す（既存項目は変えない）。
      // 最も古い口座の記録が7日（168時間）を超えたときも判定不可（known=false）
      negative_balance_risk: input.cashflow.projectedDays.some(day => day.isNegative),
      negative_balance_risk_known: shortfallJudgeable({
        balanceKnown: input.cashflow.startingBalance !== null && input.cashflow.startingBalance !== undefined,
        oldestRecordedAt: input.cashflow.startingBalanceOldestRecordedAt ?? null,
        now: new Date(input.generatedAt),
      }),
      // 予測は今日起点で、残高記録日以降の引落が未反映。記録日が今日、または残高不明なら null
      negative_balance_risk_caveat: negativeBalanceCaveat(input.cashflow, input.generatedAt),
    },
    confidence: plan.confidence,
  }
}

function negativeBalanceCaveat(cashflow: CashflowLoad, generatedAt: string): string | null {
  if (cashflow.startingBalance === null || cashflow.startingBalance === undefined) return null
  const message = noShortfallMessage({
    oldestRecordedAt: cashflow.startingBalanceOldestRecordedAt ?? null,
    today: balanceDateKey(generatedAt),
  })
  return message === NO_SHORTFALL_PLAIN ? null : message
}
