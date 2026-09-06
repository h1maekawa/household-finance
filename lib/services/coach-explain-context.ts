// lib/services/coach-explain-context.ts
//
// AI へ渡す「計算済みデータ」。純関数。
//
// 生の取引やカード明細は渡さない。渡すのは決定的エンジンが出した数字だけで、
// AI の役割はそれを説明することに限る。
import type { AssetPlanningResult } from './asset-planning'
import type { AssetSummary } from './asset-summary-loader'
import { getSpendingPaceState, SPENDING_PACE_LABEL } from './spending-pace'

const yen = (n: number | null | undefined) =>
  n === null || n === undefined ? '未計算' : `${Math.round(n).toLocaleString('ja-JP')}円`

export function buildCoachExplainContext(
  plan: AssetPlanningResult,
  assets: AssetSummary
): string {
  const lines: string[] = [
    `対象月: ${plan.month}`,
    `今月あと使える変動費: ${yen(plan.cashflow.freeToSpend)}（残り${plan.cashflow.daysLeft}日、1日あたり ${yen(plan.cashflow.dailyAllowance)}）`,
    `変動費の使用ペース: ${plan.cashflow.pace}（${SPENDING_PACE_LABEL[getSpendingPaceState(plan.cashflow.pace)]}。1.0が理想どおり）`,
    '',
    '今月のお金の配分（同じ原資を上から順に分けたもの。別々の財布ではない）',
    `- 再配分できる現金: ${yen(plan.allocatableCash)}`,
    `- 防衛資金へ確保: ${yen(plan.allocation.emergencyFund)}（手元の現金の振り替えで、毎月の積立ではない）`,
    `- 通常貯金へ配分: ${yen(plan.allocation.savings)}`,
    `- 資産形成へ配分: ${yen(plan.allocation.assetBuilding)}`,
    `- 未配分の余力: ${yen(plan.allocation.unallocatedCash)}`,
    `- 毎月の積立（通常貯金＋資産形成）: ${yen(plan.monthlyAssetContribution)}`,
    '',
    '現金防衛資金',
    `- 状態: ${plan.emergencyFund.status}`,
    `- 必要額: ${yen(plan.emergencyFund.requiredReserve)}（生活費を安全側に見た目安）`,
    `- 現在: ${yen(plan.emergencyFund.currentReserve)} / 不足: ${yen(plan.emergencyFund.reserveGap)}`,
    '',
    '資産',
    `- 総資産: ${yen(assets.totalAssets)}（借入は差し引いていない）`,
    `- 現金・預金: ${yen(assets.liquidCash)} / 株式: ${yen(assets.stockValue)} / 投資信託: ${yen(assets.fundValue)}`,
  ]

  if (plan.moneyPlan.steps.length > 0) {
    lines.push('', 'お金の流れ')
    for (const step of plan.moneyPlan.steps) {
      lines.push(`- ${step.label}: ${step.sign}${yen(step.amount)}`)
    }
  }

  if (plan.goals.length > 0) {
    lines.push('', '目標')
    for (const goal of plan.goals) {
      lines.push(
        `- ${goal.title}: 残り ${yen(goal.remainingAmount)}、必要な毎月の積立 ${yen(goal.requiredMonthly)}、状態 ${goal.statusLabel}`
      )
    }
  }

  if (plan.projection.length > 0) {
    lines.push('', '将来の資産（利回り0%の単純積立）')
    for (const point of plan.projection) {
      lines.push(`- ${point.years}年後: ${yen(point.projectedAssets)}`)
    }
  }

  lines.push('', `信頼度: ${plan.confidence}`)
  if (plan.missingData.length > 0) {
    lines.push(`不足している設定: ${plan.missingData.join(' / ')}`)
  }

  return lines.join('\n')
}
