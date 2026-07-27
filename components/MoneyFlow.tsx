'use client'
// components/MoneyFlow.tsx
// 「今月のお金の流れ」を1本の滝として見せる。
// 収入を100%とした横バーで、固定費 → 目標 → 投資 と削られ、
// 最後に残る「自由に使えるお金」までを一目で追えるようにする。
import { useState } from 'react'
import type { MoneyPlan, PlanStep } from '@/lib/services/money-plan'

const STEP_STYLE: Record<PlanStep['key'], { bar: string; text: string }> = {
  income:     { bar: 'bg-primary',        text: 'text-primary' },
  fixed:      { bar: 'bg-[#7C5CFF]',      text: 'text-[#7C5CFF]' },
  goals:      { bar: 'bg-warning',        text: 'text-warning' },
  investment: { bar: 'bg-[#2F80ED]',      text: 'text-[#2F80ED]' },
  buffer:     { bar: 'bg-muted',          text: 'text-muted' },
  free:       { bar: 'bg-success',        text: 'text-success' },
}

export default function MoneyFlow({ plan }: { plan: MoneyPlan }) {
  const overspent = plan.remaining < 0

  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-bold">今月のお金の流れ</h2>
        <span className="text-xs text-muted">
          固定費率 {(plan.fixedRatio * 100).toFixed(1)}%
        </span>
      </div>

      {/* 全体の比率を1本の帯で。ここだけ見れば構成が分かる */}
      <ProportionBar plan={plan} />

      <div className="mt-4 flex flex-col">
        {plan.steps.map((step, i) => (
          <StepRow key={step.key} step={step} isLast={i === plan.steps.length - 1} />
        ))}
      </div>

      {/* 自由予算の消化状況 */}
      <div className="mt-4 rounded-2xl bg-surface p-3.5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted">今月あと使える額</span>
          <span className={`text-2xl font-bold ${overspent ? 'text-danger' : ''}`}>
            {plan.remaining.toLocaleString()}
            <span className="ml-0.5 text-sm font-normal">円</span>
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-card">
          <div
            className={`h-full rounded-full ${overspent ? 'bg-danger' : 'bg-success'}`}
            style={{ width: `${Math.min(pct(plan.spent, plan.freeBudget), 100)}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] text-muted">
          自由予算 {plan.freeBudget.toLocaleString()}円 のうち {plan.spent.toLocaleString()}円 を使用
          {plan.daysLeft > 0 && ` ・ 残り${plan.daysLeft}日で1日あたり ${plan.dailyAllowance.toLocaleString()}円`}
        </p>
      </div>
    </section>
  )
}

function ProportionBar({ plan }: { plan: MoneyPlan }) {
  const segments = plan.steps.filter(s => s.key !== 'income' && s.amount > 0)
  const income = plan.steps[0]?.amount ?? 0
  if (income <= 0) return null

  return (
    <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-surface">
      {segments.map(step => (
        <div
          key={step.key}
          className={STEP_STYLE[step.key].bar}
          style={{ width: `${pct(step.amount, income)}%` }}
          title={`${step.label} ${step.amount.toLocaleString()}円`}
        />
      ))}
    </div>
  )
}

function StepRow({ step, isLast }: { step: PlanStep; isLast: boolean }) {
  const [open, setOpen] = useState(false)
  const style = STEP_STYLE[step.key]
  const hasBreakdown = step.breakdown.length > 0
  const isFree = step.key === 'free'

  return (
    <div className={isLast ? '' : 'border-b border-border'}>
      <button
        type="button"
        onClick={() => hasBreakdown && setOpen(o => !o)}
        disabled={!hasBreakdown}
        aria-expanded={hasBreakdown ? open : undefined}
        // ラベルと金額が入れ子の span に分かれていて読み上げ名が空になるため明示する
        aria-label={`${step.label} ${step.amount.toLocaleString()}円${hasBreakdown ? '（内訳を開く）' : ''}`}
        className="flex w-full items-center gap-2.5 py-2.5 text-left transition-base disabled:cursor-default"
      >
        <span className={`w-4 shrink-0 text-center text-sm ${style.text}`}>{step.sign}</span>

        <span className="min-w-0 flex-1">
          <span className={`block text-sm ${isFree ? 'font-bold' : ''}`}>
            {step.label}
            {hasBreakdown && (
              <span className="ml-1.5 text-[10px] text-muted">{open ? '▲' : '▼'}</span>
            )}
          </span>
          {/* ステップごとの比率バー */}
          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface">
            <span
              className={`block h-full rounded-full ${style.bar}`}
              style={{ width: `${Math.min(step.ratio * 100, 100)}%` }}
            />
          </span>
        </span>

        <span className={`shrink-0 text-right tabular-nums ${isFree ? 'text-lg font-bold' : 'text-sm'} ${isFree ? style.text : ''}`}>
          {step.amount.toLocaleString()}
          <span className="ml-0.5 text-[11px] font-normal text-muted">円</span>
        </span>
      </button>

      {open && hasBreakdown && (
        <ul className="pb-3 pl-6.5 pr-1">
          {step.breakdown.map(item => (
            <li key={item.label} className="flex items-baseline justify-between py-1 text-xs">
              <span className="min-w-0 truncate text-muted">
                {item.label}
                {item.note && <span className="ml-1.5 text-[10px]">{item.note}</span>}
              </span>
              <span className="shrink-0 tabular-nums">{item.amount.toLocaleString()}円</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function pct(value: number, total: number): number {
  if (total <= 0) return 0
  return (value / total) * 100
}
