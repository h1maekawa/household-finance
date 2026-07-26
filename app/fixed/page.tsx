'use client'
// 固定収支 — 毎月のお金を設計する場所(要件定義書 v3.1)。
//
// 固定収入・固定費・月次予算を1画面に集めた。これまで固定収入は設定、
// 固定費はキャッシュフロー、予算はダッシュボードにバラバラに置かれていた。
//
// 要件書の第4タブ「AI分析(削減候補)」は新規機能のため今回は作らない
// (docs/v3.1-review.md の実装順序を参照)。
import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/fetcher'
import PageShell, { PageTabs } from '@/components/PageShell'
import FixedIncomeCard from '@/components/FixedIncomeCard'
import BudgetCard from '@/components/BudgetCard'
import ScheduledPaymentList from '@/components/ScheduledPaymentList'
import type { ScheduledPayment } from '@/types/cashflow'

const TABS = [
  { key: 'income', label: '固定収入' },
  { key: 'costs',  label: '固定費' },
  { key: 'budget', label: '月次予算' },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function FixedPage() {
  const [tab, setTab] = useState<TabKey>('costs')
  const { data: payments, mutate } = useSWR<ScheduledPayment[]>('/api/scheduled-payments', fetcher)

  return (
    <PageShell
      title="固定収支"
      description="毎月必ず発生する収入と支出を設計します"
      tabs={<PageTabs tabs={TABS} active={tab} onChange={setTab} />}
    >
      {tab === 'income' && <FixedIncomeCard />}

      {tab === 'costs' && (
        <div className="card p-4">
          <ScheduledPaymentList
            payments={Array.isArray(payments) ? payments : []}
            onMutate={mutate}
          />
        </div>
      )}

      {tab === 'budget' && <BudgetCard />}
    </PageShell>
  )
}
