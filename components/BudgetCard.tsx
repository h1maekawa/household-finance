'use client'
// components/BudgetCard.tsx
// 「今月あと使える額」。主数値 + 1日あたり + 消化バーにペース線を重ねる
// (docs/budget-design.md の UI 設計)。数値は /api/budget が計算済み。
import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import type { BudgetSummary } from '@/types/budget'
import type { CategoryProgress } from '@/types/budget'

import { fetcher } from '@/lib/fetcher'

type BudgetResponse = BudgetSummary & {
  categoryBudgets: Array<{ category: string; amount: number; source: string }>
}

function yen(v: number) {
  return `${v.toLocaleString()}円`
}

export default function BudgetCard() {
  const { data } = useSWR<BudgetResponse>('/api/budget', fetcher)
  const [showBreakdown, setShowBreakdown] = useState(false)

  if (!data) {
    return <div className="card p-4"><div className="skeleton h-28 w-full rounded-xl" /></div>
  }
  if ('error' in data || !data.variable) {
    return null
  }

  const { variable, income, fixed, savings, investment, buffer } = data
  const spentRate = variable.budget > 0 ? Math.min(variable.spent / variable.budget, 1) : 0
  const paceLine = variable.daysInMonth > 0 ? variable.daysElapsed / variable.daysInMonth : 0
  const overBudget = variable.remaining < 0

  const categoryBudgetMap = new Map(data.categoryBudgets?.map(c => [c.category, c.amount]) ?? [])
  const categoryProgress: CategoryProgress[] = Object.entries(variable.byCategory)
    .map(([category, spent]) => {
      const budget = categoryBudgetMap.get(category) ?? 0
      return {
        category,
        budget,
        spent,
        remaining: budget - spent,
        rate: budget > 0 ? spent / budget : 0,
        pace: 0,
        average: variable.categoryStats[category]?.average ?? 0,
        count: variable.categoryStats[category]?.count ?? 0,
      }
    })
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 5)

  return (
    <div className="card p-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-base font-bold">今月あと使える額</h2>
        <Link href="/plan" className="text-xs font-bold text-primary">予算設定</Link>
      </div>

      <p className={`text-3xl font-bold ${overBudget ? 'text-danger' : ''}`}>
        {variable.remaining.toLocaleString()}
        <span className="ml-1 text-base font-normal text-muted">円</span>
      </p>
      <p className="mt-1 text-xs text-muted">
        1日あたり {yen(variable.dailyAllowance)} / 残り {variable.daysLeft}日
        {variable.pace > 0 && (
          <span className={variable.pace > 1.1 ? 'ml-2 font-bold text-danger' : 'ml-2 text-success'}>
            ペース {variable.pace.toFixed(2)}
          </span>
        )}
      </p>

      {/* 消化バー + ペース線 */}
      <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-surface">
        <div
          className={`h-full rounded-full ${overBudget ? 'bg-danger' : spentRate > paceLine ? 'bg-warning' : 'bg-success'}`}
          style={{ width: `${Math.max(spentRate * 100, 2)}%` }}
        />
        <div
          className="absolute top-0 h-full w-0.5 bg-[#1E2933]/60"
          style={{ left: `${paceLine * 100}%` }}
          title="今日の位置"
        />
      </div>
      <p className="mt-1 text-[11px] text-muted">
        {yen(variable.spent)} / {yen(variable.budget)} 消化 · 縦線が今日の位置。線より手前なら黒字ペース
      </p>

      <button
        type="button"
        onClick={() => setShowBreakdown(v => !v)}
        className="mt-3 text-xs font-bold text-primary"
      >
        {showBreakdown ? '内訳を閉じる' : '内訳を見る'}
      </button>

      {showBreakdown && (
        <div className="mt-2 space-y-1 border-t border-border pt-2 text-xs text-muted">
          <Row label="収入見込み" value={income.planned} sign="+" />
          <Row label={`固定費(済${fixed.paid > 0 ? '有' : '無'}/未${fixed.unpaid > 0 ? '有' : '無'})`} value={fixed.effective} sign="−" />
          <Row label="投資" value={investment.target} sign="−" />
          <Row label="貯蓄" value={savings.target} sign="−" />
          <Row label="予備費" value={buffer} sign="−" />
          <div className="flex justify-between border-t border-border pt-1 font-bold text-foreground">
            <span>変動費の枠</span>
            <span className="font-mono">{yen(variable.budget)}</span>
          </div>
        </div>
      )}

      {categoryProgress.length > 0 && (
        <div className="mt-4 space-y-2.5 border-t border-border pt-3">
          <p className="text-xs font-bold">カテゴリ別</p>
          {categoryProgress.map(c => {
            const rate = c.budget > 0 ? Math.min(c.spent / c.budget, 1) : 0
            const over = c.budget > 0 && c.spent > c.budget
            return (
              <div key={c.category}>
                <div className="mb-0.5 flex items-center justify-between text-xs">
                  <span className="font-medium">{c.category}</span>
                  <span className={over ? 'font-bold text-danger' : 'text-muted'}>
                    {yen(c.spent)}{c.budget > 0 && ` / ${yen(c.budget)}`}
                  </span>
                </div>
                {c.budget > 0 && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface">
                    <div
                      className={`h-full rounded-full ${over ? 'bg-danger' : 'bg-primary'}`}
                      style={{ width: `${Math.max(rate * 100, 2)}%` }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Row({ label, value, sign }: { label: string; value: number; sign: '+' | '−' }) {
  return (
    <div className="flex justify-between">
      <span>{sign} {label}</span>
      <span className="font-mono">{value.toLocaleString()}円</span>
    </div>
  )
}
