'use client'
// 「予定」ページの中身。
//
// 4つのタブで、これからのお金を段階的に見る:
//   今月   … お金の流れと今月の配分。固定費の登録もここ
//   支払い … いつ・どの口座から・いくら出ていくか(旧キャッシュフロー)
//   目標   … 目標ごとの進捗と必要な積立
//   将来   … 現在資産と積立からの単純予測
import useSWR from 'swr'
import { fetcher } from '@/lib/fetcher'
import PageShell from '@/components/PageShell'
import PageTabs, { useActiveTab, type PageTab } from '@/components/PageTabs'
import MoneyFlow from '@/components/MoneyFlow'
import VariableBudgetList from '@/components/VariableBudgetList'
import GoalList from '@/components/GoalList'
import DebtsSummaryCard from '@/components/DebtsSummaryCard'
import FixedIncomeCard from '@/components/FixedIncomeCard'
import ScheduledPaymentList from '@/components/ScheduledPaymentList'
import BulkFixedCostImport from '@/components/BulkFixedCostImport'
import UpcomingPayments from '@/components/UpcomingPayments'
import AllocationCard from '@/components/plan/AllocationCard'
import ProjectionCard from '@/components/plan/ProjectionCard'
import type { AssetPlanningResult } from '@/lib/services/asset-planning'
import type { ResolvedScheduledPayment } from '@/types/cashflow'

const TABS: PageTab[] = [
  { key: 'month', label: '今月' },
  { key: 'payments', label: '支払い' },
  { key: 'goals', label: '目標' },
  { key: 'future', label: '将来' },
]

// 旧タブ(?tab=fixed)からのリンクを壊さない。固定費は「今月」の中に置いた
const LEGACY_TABS: Record<string, string> = { fixed: 'month' }

const DESCRIPTIONS: Record<string, string> = {
  month: '収入から固定費・貯金・資産形成を引いて、今月いくら使えるかを設計します',
  payments: 'いつ・どの口座から・いくら出ていくかを確認します',
  goals: '目標ごとの進捗と、必要な毎月の積立を確認します',
  future: '現在の資産と積立から、将来の資産を単純計算します',
}

export default function PlanTabs() {
  const rawActive = useActiveTab(TABS)
  const active = LEGACY_TABS[rawActive] ?? rawActive

  const { data: payments, mutate: mutatePayments } =
    useSWR<ResolvedScheduledPayment[]>('/api/scheduled-payments', fetcher)

  const fixedPayments = Array.isArray(payments) ? payments : []

  // お金の流れはサーバー(asset-planning)が組み立てたものを読む。
  // 以前はここで buildMoneyPlan を呼んでおり、UIに金融計算が乗っていた
  const { data: assetPlan } = useSWR<AssetPlanningResult>('/api/asset-planning', fetcher)
  const plan = assetPlan?.moneyPlan ?? null

  return (
    <PageShell title="お金の予定" description={DESCRIPTIONS[active]}>
      <div className="flex flex-col gap-5">
        <PageTabs tabs={TABS} active={active} />

        {active === 'month' && (
          <>
            {plan ? (
              <>
                <MoneyFlow plan={plan} />
                {assetPlan && <AllocationCard plan={assetPlan} />}
                <VariableBudgetList categories={plan.categories} freeBudget={plan.freeBudget} />
              </>
            ) : (
              <div className="card p-4"><div className="skeleton h-64 w-full rounded-xl" /></div>
            )}
            <FixedIncomeCard />
            <DebtsSummaryCard />
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

        {active === 'payments' && <UpcomingPayments />}

        {active === 'goals' && <GoalList />}

        {active === 'future' &&
          (assetPlan ? (
            <ProjectionCard plan={assetPlan} />
          ) : (
            <div className="card p-4"><div className="skeleton h-48 w-full rounded-xl" /></div>
          ))}
      </div>
    </PageShell>
  )
}
