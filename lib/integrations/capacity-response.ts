// investment-capacity API のレスポンス組み立て（純関数）。
// route.ts と結合テストのフィクスチャ生成が同じ組み立てを使う。
// フィールドは追加のみ。削除・改名しない（docs/AI_COMPANY_INTEGRATION.md「変更時の注意」）。
import type { CapacityResult } from '@/lib/services/investment-capacity'
import { withHeldReserve, type EmergencyFundResult } from '@/lib/services/emergency-fund'
import type { LiquidCash } from '@/lib/services/liquid-cash'
import type { BudgetSummary } from '@/types/budget'

export type CapacityResponseInput = {
  capacity: CapacityResult
  emergencyFund: EmergencyFundResult
  budgetSummary: BudgetSummary
  liquidCash: Pick<LiquidCash, 'recordedAt' | 'source'>
  /** budgetLoad.source */
  source: string
  /** 算出時刻。I/O境界（route）で1回だけ作って渡す */
  now: Date
}

export function toCapacityResponse(input: CapacityResponseInput) {
  const { capacity, emergencyFund, budgetSummary: budget, liquidCash, source, now } = input
  return {
    ...capacity,
    // 算出時刻は純関数の外（I/O境界）で付ける。既存レスポンスとの互換のため維持する
    calculated_at: now.toISOString(),
    // 防衛資金は配分と同じ「支払い後の原資」基準で返す（総残高で「充足」と出さない）。
    emergency_fund: withHeldReserve(
      emergencyFund,
      capacity.allocation.emergency_fund,
      capacity.emergency_fund_status
    ),
    // 家計側の「今月あといくら使えるか」もそのまま渡す
    living: {
      variable_budget: budget.variable.budget,
      spent: budget.variable.spent,
      remaining: budget.variable.remaining,
      days_left: budget.variable.daysLeft,
      daily_allowance: budget.variable.dailyAllowance,
      pace: budget.variable.pace,
    },
    balance_recorded_at: liquidCash.recordedAt,
    liquid_cash_source: liquidCash.source,
    source,
  }
}

export type CapacityResponse = ReturnType<typeof toCapacityResponse>
