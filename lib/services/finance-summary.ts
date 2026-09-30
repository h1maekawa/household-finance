import type { AssetPlanningLoad } from './asset-planning-loader'
import type { CashflowLoad } from './cashflow-loader'

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
      negative_balance_risk: input.cashflow.projectedDays.some(day => day.isNegative),
    },
    confidence: plan.confidence,
  }
}
