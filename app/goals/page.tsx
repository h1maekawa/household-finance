'use client'
// 目標・ミッション — 人生の目標を管理する場所(要件定義書 v3.1)。
//
// Wish List・購入計画・AI提案タブは次フェーズ(docs/v3.1-review.md)。
// 今回は「既存のAPIとエンジンにUIを与える」ところまで。
import PageShell from '@/components/PageShell'
import GoalCard from '@/components/GoalCard'
import GoalList from '@/components/GoalList'
import DebtsSummaryCard from '@/components/DebtsSummaryCard'

export default function GoalsPage() {
  return (
    <PageShell
      title="目標・ミッション"
      description="人生の目標と、その達成に必要な毎月の積立額を管理します"
    >
      <div className="flex flex-col gap-5">
        <GoalCard />
        <GoalList />
        <DebtsSummaryCard />
      </div>
    </PageShell>
  )
}
