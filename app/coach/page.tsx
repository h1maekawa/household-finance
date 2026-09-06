'use client'
// app/coach/page.tsx
//
// AI Coach。役割は「Flow+ の計算結果を説明する場所」。
// 金額は決定的エンジンが出したものをそのまま使い、ここで作らない。
import useSWR from 'swr'
import { Sparkles } from 'lucide-react'
import CoachCard from '@/components/CoachCard'
import { yen } from '@/components/home/AmountBlock'
import { fetcher } from '@/lib/fetcher'
import { ICON_STROKE } from '@/lib/nav'
import type { AssetPlanningResult } from '@/lib/services/asset-planning'

const QUICK_PROMPTS = [
  '今月使いすぎ？',
  '貯金目標は達成できる？',
  '来月いくら使える？',
  '固定費を見直したい',
]

export default function CoachPage() {
  const { data: plan } = useSWR<AssetPlanningResult>('/api/asset-planning', fetcher)

  return (
    <div className="mx-auto max-w-xl">
      <header className="px-4 pt-5">
        <div className="flex items-center gap-2">
          <Sparkles size={18} strokeWidth={ICON_STROKE} className="text-primary" aria-hidden />
          <h1 className="text-lg font-bold">AI Coach</h1>
        </div>
        <p className="mt-1 text-[12px] text-muted">今月のお金について</p>
      </header>

      <div className="space-y-3 p-4">
        {plan && (
          <section className="card p-4">
            <p className="text-[12px] text-muted">今月あと使える</p>
            <p className="mt-0.5 text-[28px] font-bold tabular-nums leading-tight">
              {yen(plan.cashflow.freeToSpend)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted">
              残り{plan.cashflow.daysLeft}日 ・ 1日あたり {yen(plan.cashflow.dailyAllowance)}
            </p>
          </section>
        )}

        <CoachCard />

        {/* 対話は未実装。押せそうに見せると「動かないボタン」になるので、
            近日公開であることを明示して並べるだけにする */}
        <section className="card p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[13px] font-bold">相談する</h2>
            <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] text-muted">
              近日公開
            </span>
          </div>
          <p className="mt-1.5 text-[12px] text-muted">
            計算結果をもとに質問できるようにする予定です。
          </p>
          <ul className="mt-2.5 space-y-1.5">
            {QUICK_PROMPTS.map(prompt => (
              <li key={prompt} className="text-[12px] text-muted">
                ・{prompt}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
