'use client'
// マネープラン — /fixed・/goals・/ai を統合したページ。
//
// 要件定義書 v3.1 の「お金の流れ」を1画面で追えるようにする:
//   収入 → 固定費(カテゴリ別) → 目標・ミッション → 投資 → 自由に使えるお金 → カテゴリ配分
//
// 上半分が「見る」(可視化)、下半分が「直す」(編集)。3ページに分かれていたときは
// 固定費を直してから予算への影響を見るのに画面移動が必要だった。
import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/fetcher'
import PageShell from '@/components/PageShell'
import MoneyFlow from '@/components/MoneyFlow'
import VariableBudgetList from '@/components/VariableBudgetList'
import CoachCard from '@/components/CoachCard'
import GoalList from '@/components/GoalList'
import DebtsSummaryCard from '@/components/DebtsSummaryCard'
import FixedIncomeCard from '@/components/FixedIncomeCard'
import ScheduledPaymentList from '@/components/ScheduledPaymentList'
import BulkFixedCostImport from '@/components/BulkFixedCostImport'
import { buildMoneyPlan } from '@/lib/services/money-plan'
import type { BudgetSummary, CategoryBudget } from '@/types/budget'
import type { GoalProgress } from '@/types/goal'
import type { ResolvedScheduledPayment } from '@/types/cashflow'

type BudgetResponse = BudgetSummary & { categoryBudgets?: CategoryBudget[] }

export default function PlanPage() {
  const { data: budget } = useSWR<BudgetResponse>('/api/budget', fetcher)
  const { data: payments, mutate: mutatePayments } =
    useSWR<ResolvedScheduledPayment[]>('/api/scheduled-payments', fetcher)
  const { data: goalData } = useSWR<{ goals: GoalProgress[] }>('/api/goals/progress', fetcher)

  const fixedPayments = Array.isArray(payments) ? payments : []
  const goals = Array.isArray(goalData?.goals) ? goalData.goals : []

  const plan = budget?.variable
    ? buildMoneyPlan({
        month: budget.month,
        budget,
        categoryBudgets: budget.categoryBudgets ?? [],
        fixedPayments,
        goals,
      })
    : null

  return (
    <PageShell
      title="マネープラン"
      description="収入から固定費・目標を引いて、今月いくら自由に使えるかを設計します"
    >
      <div className="flex flex-col gap-5">
        <CoachCard />

        {plan ? (
          <>
            <MoneyFlow plan={plan} />
            <VariableBudgetList categories={plan.categories} freeBudget={plan.freeBudget} />
          </>
        ) : (
          <div className="card p-4"><div className="skeleton h-64 w-full rounded-xl" /></div>
        )}

        <Section title="固定収入" defaultOpen={false}>
          <FixedIncomeCard />
        </Section>

        <Section title="固定費" defaultOpen={fixedPayments.length === 0}>
          <div className="flex flex-col gap-3">
            {/* 未登録のうちは一括登録を前面に出す。1件ずつ入れるのは現実的でない */}
            <div className="card p-4">
              <h3 className="text-sm font-bold">固定費をまとめて登録</h3>
              <p className="mb-3 mt-1 text-xs leading-relaxed text-muted">
                家賃・光熱費・通信費・積立をまとめて登録します。登録前に内容を確認できます。
              </p>
              <BulkFixedCostImport onImported={mutatePayments} />
            </div>
            <div className="card p-4">
              <ScheduledPaymentList payments={fixedPayments} onMutate={mutatePayments} />
            </div>
          </div>
        </Section>

        <Section title="目標・ミッション" defaultOpen={goals.length === 0}>
          <div className="flex flex-col gap-5">
            <GoalList />
            <DebtsSummaryCard />
          </div>
        </Section>
      </div>
    </PageShell>
  )
}

/**
 * 編集セクションは既定で畳む。可視化を先に見せたいのと、
 * 未登録のとき(固定費0件・目標0件)だけ開いて入力へ誘導するため。
 */
function Section({
  title, defaultOpen, children,
}: {
  title: string
  defaultOpen: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-2xl bg-surface px-4 py-3 text-sm font-bold transition-base active:opacity-80"
      >
        {title}
        <span className="text-xs font-normal text-muted">{open ? '閉じる ▲' : '編集する ▼'}</span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  )
}
