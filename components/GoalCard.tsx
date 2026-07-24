'use client'
// components/GoalCard.tsx
// 目標カード。達成率バー + 達成予測月。数値は /api/goals/progress が計算済み。
import useSWR from 'swr'
import Link from 'next/link'
import type { GoalProgress } from '@/types/goal'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const STATUS_STYLE: Record<GoalProgress['status'], { label: string; className: string }> = {
  achieved: { label: '達成', className: 'bg-success/10 text-success' },
  on_track: { label: '順調', className: 'bg-success/10 text-success' },
  behind: { label: '遅れ', className: 'bg-warning/10 text-warning' },
  stalled: { label: '停滞', className: 'bg-danger/10 text-danger' },
  unplanned: { label: '未設定', className: 'bg-surface text-muted' },
}

function formatMonth(month: string | null) {
  if (!month) return '—'
  const [year, m] = month.split('-')
  return `${year}年${Number(m)}月`
}

export default function GoalCard() {
  const { data } = useSWR<{ goals: GoalProgress[] }>('/api/goals/progress', fetcher)

  if (!data) {
    return <div className="card p-4"><div className="skeleton h-24 w-full rounded-xl" /></div>
  }
  const goals = data.goals ?? []

  if (goals.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-2 p-6 text-center">
        <span className="text-3xl">🎯</span>
        <p className="text-sm font-bold">目標を1つ決めましょう</p>
        <p className="text-xs text-muted">目標を設定すると、毎月いくら貯めればよいか自動で計算します。</p>
        <Link href="/onboarding" className="mt-1 rounded-full bg-primary px-4 py-2 text-xs font-bold text-white">
          目標を設定する
        </Link>
      </div>
    )
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold">目標の進捗</h2>
        <Link href="/onboarding" className="text-xs font-bold text-primary">追加・編集</Link>
      </div>
      <div className="space-y-4">
        {goals.map(goal => {
          const style = STATUS_STYLE[goal.status]
          const rate = Math.min(goal.progressRate, 1)
          return (
            <div key={goal.goalId}>
              <div className="mb-1 flex items-center gap-2">
                <span className="text-sm font-bold">{goal.title}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${style.className}`}>
                  {style.label}
                </span>
                {goal.targetAmount !== null && (
                  <span className="ml-auto text-xs text-muted">{Math.round(goal.progressRate * 100)}%</span>
                )}
              </div>
              {goal.targetAmount !== null && (
                <>
                  <div className="h-2 overflow-hidden rounded-full bg-surface">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(rate * 100, 2)}%` }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                    <span>
                      {goal.currentAmount.toLocaleString()} / {goal.targetAmount.toLocaleString()}円
                    </span>
                    {goal.projectedAchievementMonth && (
                      <span>予測 {formatMonth(goal.projectedAchievementMonth)}</span>
                    )}
                  </div>
                  {goal.status === 'behind' && goal.requiredMonthly !== null && (
                    <p className="mt-1 text-[11px] text-warning">
                      目標には毎月 {goal.requiredMonthly.toLocaleString()}円 必要(現在ペース {goal.monthlyPace.toLocaleString()}円)
                    </p>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
