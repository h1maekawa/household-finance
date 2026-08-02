'use client'
// 「予定」ページの中身。
//
// 3つのタブで、これからのお金を段階的に見る:
//   今月の計画   … 収入から固定費・投資・貯金を引いて、今月あといくら使えるか
//   支払い予定   … いつ・どの口座から・いくら出ていくか(旧キャッシュフロー)
//   固定費       … その計画の前提になる定期支出そのもの
import useSWR from 'swr'
import { fetcher } from '@/lib/fetcher'
import PageShell from '@/components/PageShell'
import PageTabs, { useActiveTab, type PageTab } from '@/components/PageTabs'
import MoneyFlow from '@/components/MoneyFlow'
import VariableBudgetList from '@/components/VariableBudgetList'
import CoachCard from '@/components/CoachCard'
import GoalList from '@/components/GoalList'
import DebtsSummaryCard from '@/components/DebtsSummaryCard'
import FixedIncomeCard from '@/components/FixedIncomeCard'
import ScheduledPaymentList from '@/components/ScheduledPaymentList'
import BulkFixedCostImport from '@/components/BulkFixedCostImport'
import UpcomingPayments from '@/components/UpcomingPayments'
import { buildMoneyPlan } from '@/lib/services/money-plan'
import type { BudgetSummary, CategoryBudget } from '@/types/budget'
import type { GoalProgress } from '@/types/goal'
import type { ResolvedScheduledPayment } from '@/types/cashflow'

type BudgetResponse = BudgetSummary & { categoryBudgets?: CategoryBudget[] }

const TABS: PageTab[] = [
  { key: 'month', label: '今月の計画' },
  { key: 'payments', label: '支払い予定' },
  { key: 'fixed', label: '固定費' },
]

const DESCRIPTIONS: Record<string, string> = {
  month: '収入から固定費・投資・貯金を引いて、今月いくら使えるかを設計します',
  payments: 'いつ・どの口座から・いくら出ていくかを確認します',
  fixed: '毎月かかる定期支出を登録・確認します',
}

export default function PlanTabs() {
  const active = useActiveTab(TABS)

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
    <PageShell title="お金の予定" description={DESCRIPTIONS[active]}>
      <div className="flex flex-col gap-5">
        <PageTabs tabs={TABS} active={active} />

        {active === 'month' && (
          <>
            <CoachCard />
            {plan ? (
              <>
                <MoneyFlow plan={plan} />
                <VariableBudgetList categories={plan.categories} freeBudget={plan.freeBudget} />
              </>
            ) : (
              <div className="card p-4"><div className="skeleton h-64 w-full rounded-xl" /></div>
            )}
            <FixedIncomeCard />
            <GoalList />
            <DebtsSummaryCard />
          </>
        )}

        {active === 'payments' && <UpcomingPayments />}

        {active === 'fixed' && (
          <>
            {/* 未登録のうちは一括登録を前面に出す。1件ずつ入れるのは現実的でない */}
            <div className="card p-4">
              <h2 className="text-sm font-bold">固定費をまとめて登録</h2>
              <p className="mb-3 mt-1 text-xs leading-relaxed text-muted">
                家賃・光熱費・通信費・積立をまとめて登録します。登録前に内容を確認できます。
              </p>
              <BulkFixedCostImport onImported={mutatePayments} />
            </div>
            <div className="card p-4">
              <ScheduledPaymentList payments={fixedPayments} onMutate={mutatePayments} />
            </div>
          </>
        )}
      </div>
    </PageShell>
  )
}
