'use client'
// 未来を比較（スペック §17〜§21）。
//
// 金額・到達月・短縮期間はすべてサーバー（scenario-engine.ts）が出した値を
// 表示するだけ。ここで複利を回したり、削減額を掛け算したりしない。
//
// 利回りは仮定なので、「確実に」「必ず」と読める表現は使わない（スペック §32）。
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/fetcher'
import { yen, NotAvailable } from '@/components/home/AmountBlock'
import {
  EXPENSE_REDUCTION_RATIOS,
  formatMonthsDuration,
} from '@/lib/services/scenario-engine'
import {
  DEFAULT_SCENARIO_RETURN_RATE,
  OFFICIAL_RETURN_RATES,
} from '@/lib/services/return-assumptions'
import type { ScenarioComparison, ScenarioResult } from '@/lib/services/scenario-engine'
import type { ScenarioLoad, ScenarioTargetOption } from '@/lib/services/scenario-loader'
import type { CategoryExpense } from '@/lib/services/expense-intelligence'

const percent = (rate: number) => `${Number((rate * 100).toFixed(3))}%`

/** 到達しない場合の言い方だけ画面ごとに決める。整形は scenario-engine が持つ */
const duration = (months: number | null): string | null =>
  months === null ? null : formatMonthsDuration(months)

/** 'YYYY-MM' を「2041年8月」にする */
function monthLabel(month: string | null): string | null {
  if (!month) return null
  const [year, m] = month.split('-')
  return `${year}年${Number(m)}月`
}

type Adjustments = {
  expenseCategory: string
  expenseRatio: number
  extraContribution: string
  additionalSavings: string
  additionalInvestment: string
}

const EMPTY: Adjustments = {
  expenseCategory: '',
  expenseRatio: 0.5,
  extraContribution: '',
  additionalSavings: '',
  additionalInvestment: '',
}

export default function ScenarioCompare({
  initialTargetKind = 'goal',
}: {
  initialTargetKind?: ScenarioTargetOption['kind']
}) {
  const [targetKind, setTargetKind] = useState<ScenarioTargetOption['kind']>(initialTargetKind)
  const [goalId, setGoalId] = useState<string | null>(null)
  const [returnRate, setReturnRate] = useState<number>(DEFAULT_SCENARIO_RETURN_RATE)
  const [adjustments, setAdjustments] = useState<Adjustments>(EMPTY)
  // 支出削減はカテゴリを選ぶだけ。金額はサーバーが Expense Intelligence から出す
  const { data: intelligence } = useSWR<{ categories: CategoryExpense[] }>(
    '/api/expense-intelligence',
    fetcher
  )
  const categories = (intelligence?.categories ?? []).filter(c => c.currentMonth > 0)

  // 条件が変わるたびにサーバーで計算し直す。結果は保存しない（スペック §25）
  const body = useMemo(
    () =>
      JSON.stringify({
        target_kind: targetKind,
        goal_id: goalId,
        annual_return_rate: returnRate,
        additional_monthly_savings: Number(adjustments.additionalSavings) || 0,
        additional_monthly_investment: Number(adjustments.additionalInvestment) || 0,
        monthly_extra_contribution: Number(adjustments.extraContribution) || 0,
        expense_reduction: adjustments.expenseCategory
          ? { category: adjustments.expenseCategory, ratio: adjustments.expenseRatio }
          : null,
      }),
    [targetKind, goalId, returnRate, adjustments]
  )

  const { data, isLoading } = useSWR<ScenarioLoad>(
    ['/api/scenarios/compare', body],
    ([url, payload]: [string, string]) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      }).then(res => res.json()),
    // 条件を変えている最中に画面が空になると比較しづらいので前の結果を残す
    { keepPreviousData: true }
  )

  if (isLoading && !data) {
    return (
      <section className="card p-4">
        <div className="skeleton h-64 w-full rounded-xl" />
      </section>
    )
  }
  if (!data) {
    return (
      <section className="card p-4">
        <h2 className="text-sm font-bold">未来を比較</h2>
        <div className="mt-2.5">
          <NotAvailable hint="シミュレーションを読み込めませんでした" />
        </div>
      </section>
    )
  }

  const { selected } = data.comparison

  return (
    <section className="card p-4">
      <h2 className="text-sm font-bold">未来を比較</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        条件を変えたときに目標到達がどう動くかのシミュレーションです。
        利回りは想定で、運用成果を示すものではありません。
      </p>

      <TargetPicker
        options={data.targetOptions}
        selected={data.target}
        onSelect={option => {
          setTargetKind(option.kind)
          setGoalId(option.kind === 'goal' ? option.id : null)
        }}
      />

      <BaselineBlock result={selected.baseline} target={data.target} />

      {data.missingData.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {data.missingData.map(item => (
            <li key={item} className="text-[11px] leading-relaxed text-warning">
              {item}
            </li>
          ))}
        </ul>
      )}

      <ConditionForm
        adjustments={adjustments}
        onChange={setAdjustments}
        categories={categories}
        reduction={data.expenseReduction}
        returnRate={returnRate}
        onReturnRate={setReturnRate}
      />

      {selected.adjusted.additionalMonthlyContribution > 0 && (
        <>
          <ComparisonBlock comparison={selected} />
          <ScenarioChart comparison={selected} horizons={data.comparison.horizons} />
        </>
      )}

      <RateTable comparisons={data.comparison.byReturnRate} selectedRate={returnRate} />
    </section>
  )
}

function TargetPicker({
  options,
  selected,
  onSelect,
}: {
  options: ScenarioTargetOption[]
  selected: ScenarioTargetOption
  onSelect: (option: ScenarioTargetOption) => void
}) {
  if (options.length <= 1) return null
  return (
    <div className="mt-3">
      <span className="mb-1.5 block text-xs text-muted">どの目標で比べるか</span>
      <div className="flex flex-wrap gap-2">
        {options.map(option => (
          <button
            key={`${option.kind}-${option.id}`}
            type="button"
            onClick={() => onSelect(option)}
            aria-pressed={option.id === selected.id}
            className={`rounded-xl border px-3 py-2 text-xs transition-base ${
              option.id === selected.id
                ? 'border-primary bg-primary/5 font-bold text-primary'
                : 'border-border bg-surface text-muted'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function BaselineBlock({
  result,
  target,
}: {
  result: ScenarioResult
  target: ScenarioTargetOption
}) {
  const remaining = duration(result.monthsToTarget)

  return (
    <div className="mt-4 rounded-2xl bg-surface px-4 py-3.5">
      <p className="text-xs text-muted">現在のペース</p>
      <p className="mt-1 text-[13px]">
        {target.label}
        {target.targetAssets !== null && (
          <span className="ml-1 font-bold tabular-nums">{yen(target.targetAssets)}</span>
        )}
        まで
      </p>
      <p className="mt-1.5 text-[28px] font-bold leading-none tabular-nums">
        {remaining ? `あと${remaining}` : '—'}
      </p>
      <p className="mt-1.5 text-[11px] text-muted">
        {result.monthlyContribution === null
          ? '毎月の積立額が分かると、到達時期を出せます'
          : `毎月 ${yen(result.monthlyContribution)}`}
        {result.projectedTargetMonth && ` ・ ${monthLabel(result.projectedTargetMonth)}ごろ`}
        {result.monthsToTarget === null &&
          result.monthlyContribution !== null &&
          ' ・ 現在の条件では到達しません'}
      </p>
    </div>
  )
}

function ConditionForm({
  adjustments,
  onChange,
  categories,
  reduction,
  returnRate,
  onReturnRate,
}: {
  adjustments: Adjustments
  onChange: (next: Adjustments) => void
  categories: CategoryExpense[]
  reduction: ScenarioLoad['expenseReduction']
  returnRate: number
  onReturnRate: (rate: number) => void
}) {
  const set = (patch: Partial<Adjustments>) => onChange({ ...adjustments, ...patch })

  return (
    <div className="mt-4">
      <h3 className="text-sm font-bold">条件を変える</h3>

      <div className="mt-3 flex flex-col gap-4">
        <div>
          <label htmlFor="scenario-expense" className="mb-1 block text-xs text-muted">
            支出を減らす
          </label>
          <select
            id="scenario-expense"
            value={adjustments.expenseCategory}
            onChange={e => set({ expenseCategory: e.target.value })}
            className="w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm focus:border-primary focus:bg-card focus:outline-none"
          >
            <option value="">選ばない</option>
            {categories.map(category => (
              <option key={category.category} value={category.category}>
                {category.category}（今月 {category.currentMonth.toLocaleString('ja-JP')}円）
              </option>
            ))}
          </select>

          {adjustments.expenseCategory && (
            <>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {EXPENSE_REDUCTION_RATIOS.map(ratio => (
                  <button
                    key={ratio}
                    type="button"
                    onClick={() => set({ expenseRatio: ratio })}
                    aria-pressed={adjustments.expenseRatio === ratio}
                    className={`rounded-xl border py-2 text-xs transition-base ${
                      adjustments.expenseRatio === ratio
                        ? 'border-primary bg-primary/5 font-bold text-primary'
                        : 'border-border bg-surface text-muted'
                    }`}
                  >
                    {percent(ratio)}減
                  </button>
                ))}
              </div>
              {reduction && (
                <p className="mt-1 text-[11px] text-muted">
                  {reduction.amount === null
                    ? `${reduction.category} の当月支出が分からないため、削減額を出せません`
                    : `毎月 ${yen(reduction.amount)} を資産形成へ回した場合`}
                </p>
              )}
            </>
          )}
        </div>

        <AmountField
          id="scenario-extra"
          label="副業・収入を増やす（円 / 月）"
          hint="増えた分を資産形成へ回す条件で計算します"
          value={adjustments.extraContribution}
          onChange={value => set({ extraContribution: value })}
        />
        <AmountField
          id="scenario-savings"
          label="貯金を増やす（円 / 月）"
          value={adjustments.additionalSavings}
          onChange={value => set({ additionalSavings: value })}
        />
        <AmountField
          id="scenario-investment"
          label="投資を増やす（円 / 月）"
          value={adjustments.additionalInvestment}
          onChange={value => set({ additionalInvestment: value })}
        />

        <div>
          <span className="mb-1.5 block text-xs text-muted">想定利回り</span>
          <div className="grid grid-cols-4 gap-2">
            {OFFICIAL_RETURN_RATES.map(rate => (
              <button
                key={rate}
                type="button"
                onClick={() => onReturnRate(rate)}
                aria-pressed={returnRate === rate}
                className={`rounded-xl border py-2.5 text-sm transition-base ${
                  returnRate === rate
                    ? 'border-primary bg-primary/5 font-bold text-primary'
                    : 'border-border bg-surface text-muted'
                }`}
              >
                {percent(rate)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function AmountField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-muted">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        placeholder="0"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm font-bold tabular-nums focus:border-primary focus:bg-card focus:outline-none"
      />
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-muted">{hint}</p>}
    </div>
  )
}

function ComparisonBlock({ comparison }: { comparison: ScenarioComparison }) {
  const { baseline, adjusted, monthsSaved } = comparison

  return (
    <div className="mt-5">
      <div className="grid grid-cols-2 gap-2">
        <ScenarioColumn title="現在のペース" result={baseline} />
        <ScenarioColumn title="変更後" result={adjusted} highlight />
      </div>

      <p className="mt-3 rounded-xl bg-primary/5 px-3 py-3 text-center text-sm font-bold text-primary">
        {monthsSaved === null
          ? adjusted.monthsToTarget === null
            ? 'この条件でも到達には届きません'
            : '現在のペースでは到達しないため、短縮期間は出せません'
          : monthsSaved <= 0
            ? '到達時期は変わりません'
            : `${duration(monthsSaved)}早くなる想定です`}
      </p>
    </div>
  )
}

function ScenarioColumn({
  title,
  result,
  highlight,
}: {
  title: string
  result: ScenarioResult
  highlight?: boolean
}) {
  return (
    <div className={`rounded-2xl px-3 py-3 ${highlight ? 'bg-primary/5' : 'bg-surface'}`}>
      <p className="text-[11px] text-muted">{title}</p>
      <p className="mt-1 text-[13px] font-bold tabular-nums">
        {result.monthlyContribution === null ? '—' : `毎月 ${yen(result.monthlyContribution)}`}
      </p>
      <p className="mt-2 text-[11px] text-muted">目標まで</p>
      <p className="text-[15px] font-bold tabular-nums">
        {duration(result.monthsToTarget) ?? '到達せず'}
      </p>
      {result.projectedTargetMonth && (
        <p className="mt-0.5 text-[10px] text-muted">
          {monthLabel(result.projectedTargetMonth)}ごろ
        </p>
      )}
    </div>
  )
}

/**
 * 非常に単純な折れ線（スペック §21）。最大2シナリオ + 目標ライン。
 * 座標はここで作るが、金額はサーバーが出したものをそのまま使う。
 */
function ScenarioChart({
  comparison,
  horizons,
}: {
  comparison: ScenarioComparison
  horizons: number[]
}) {
  const { baseline, adjusted, targetAssetsLine } = {
    baseline: comparison.baseline.projection,
    adjusted: comparison.adjusted.projection,
    targetAssetsLine: comparison.adjusted.targetAssets,
  }
  if (baseline.length === 0 || adjusted.length === 0 || horizons.length < 2) return null

  const width = 320
  const height = 120
  const max = Math.max(
    ...baseline.map(p => p.projectedAssets),
    ...adjusted.map(p => p.projectedAssets),
    targetAssetsLine ?? 0,
    1
  )
  const x = (index: number) => (index / (horizons.length - 1)) * width
  const y = (value: number) => height - (value / max) * height
  const path = (points: { projectedAssets: number }[]) =>
    points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(point.projectedAssets)}`).join(' ')

  return (
    <figure className="mt-4">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-28 w-full"
        role="img"
        aria-label={`現在のペースと変更後の資産推移の比較（${horizons[horizons.length - 1]}年分）`}
      >
        {targetAssetsLine !== null && (
          <line
            x1={0}
            y1={y(targetAssetsLine)}
            x2={width}
            y2={y(targetAssetsLine)}
            stroke="var(--color-muted)"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
        )}
        <path d={path(baseline)} fill="none" stroke="var(--color-muted)" strokeWidth={2} />
        <path d={path(adjusted)} fill="none" stroke="var(--color-primary)" strokeWidth={2.5} />
      </svg>
      <figcaption className="mt-1.5 flex flex-wrap gap-3 text-[10px] text-muted">
        <span>― 現在のペース</span>
        <span className="text-primary">― 変更後</span>
        <span>--- 目標</span>
        <span>{horizons[horizons.length - 1]}年後まで</span>
      </figcaption>
    </figure>
  )
}

function RateTable({
  comparisons,
  selectedRate,
}: {
  comparisons: ScenarioComparison[]
  selectedRate: number
}) {
  return (
    <div className="mt-5">
      <h3 className="text-sm font-bold">想定利回りごとの到達</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        いずれも仮定です。この仮定が続いた場合の計算で、成果を約束するものではありません。
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {comparisons.map(comparison => (
          <li
            key={comparison.annualReturnRate}
            className={`flex items-baseline justify-between gap-3 rounded-xl px-3 py-2 ${
              comparison.annualReturnRate === selectedRate ? 'bg-surface' : ''
            }`}
          >
            <span className="text-[13px]">
              {percent(comparison.annualReturnRate)}
              {!comparison.isOfficialRate && (
                <span className="ml-1 text-[10px] text-muted">（独自の仮定）</span>
              )}
            </span>
            <span className="shrink-0 text-[13px] tabular-nums">
              <span className="text-muted">{duration(comparison.baseline.monthsToTarget) ?? '—'}</span>
              <span className="mx-1.5 text-muted">→</span>
              <span className="font-bold">
                {duration(comparison.adjusted.monthsToTarget) ?? '—'}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
