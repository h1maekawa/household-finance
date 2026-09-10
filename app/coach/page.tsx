'use client'
// app/coach/page.tsx
//
// AI FP（スペック §30 / §31）。役割は「Flow+ の計算結果をもとに相談する場所」。
// 金額は決定的エンジンが出したものをそのまま使い、ここで作らない。
//
// ルートは /coach のまま。表示名だけ AI FP へ変えている（ブックマークを壊さない）。
import useSWR from 'swr'
import { Sparkles } from 'lucide-react'
import CoachCard from '@/components/CoachCard'
import CoachChat from '@/components/coach/CoachChat'
import { yen } from '@/components/home/AmountBlock'
import { fetcher } from '@/lib/fetcher'
import { ICON_STROKE } from '@/lib/nav'
import type { AssetPlanningResult } from '@/lib/services/asset-planning'
import type { AssetSummary } from '@/lib/services/asset-summary-loader'

type PlanResponse = AssetPlanningResult & { assets: AssetSummary }

export default function CoachPage() {
  const { data: plan } = useSWR<PlanResponse>('/api/asset-planning', fetcher)
  const goal = plan?.goals[0]

  return (
    <div className="mx-auto max-w-xl">
      <header className="px-4 pt-5">
        <div className="flex items-center gap-2">
          <Sparkles size={18} strokeWidth={ICON_STROKE} className="text-primary" aria-hidden />
          <h1 className="text-lg font-bold">AI FP</h1>
        </div>
        <p className="mt-1 text-[12px] text-muted">計算結果をもとに相談する</p>
      </header>

      <div className="space-y-3 p-4">
        {/* 現在。相談の前に、いま何がどうなっているかを出す（スペック §31） */}
        <section className="card p-4">
          <p className="text-[12px] text-muted">現在</p>
          <dl className="mt-2.5 space-y-2.5">
            <Stat
              label="今月あと使える"
              value={plan ? yen(plan.cashflow.freeToSpend) : null}
              hint={plan ? `残り${plan.cashflow.daysLeft}日 ・ 1日あたり ${yen(plan.cashflow.dailyAllowance)}` : null}
              large
            />
            <Stat
              label="総資産"
              value={
                plan
                  ? plan.assets.totalAssets === null
                    ? null
                    : yen(plan.assets.totalAssets)
                  : null
              }
              hint={plan && plan.assets.totalAssets === null ? '口座残高を登録すると計算できます' : null}
            />
            <Stat
              label={goal ? `${goal.title}まで` : '目標まで'}
              value={goal ? yen(goal.remainingAmount) : null}
              hint={goal ? null : '目標を登録すると距離が出せます'}
            />
          </dl>
        </section>

        <CoachCard />

        <CoachChat />
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  large,
}: {
  label: string
  value: string | null
  hint: string | null
  large?: boolean
}) {
  return (
    <div>
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd
        className={`mt-0.5 font-bold tabular-nums leading-tight ${large ? 'text-[28px]' : 'text-[20px]'}`}
      >
        {value ?? <span className="text-[13px] font-normal text-muted">—</span>}
      </dd>
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  )
}
