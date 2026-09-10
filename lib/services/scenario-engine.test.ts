import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EXPENSE_REDUCTION_RATIOS,
  MAX_PROJECTION_MONTHS,
  additionalMonthlyContribution,
  buildScenarioComparisonSet,
  compareScenarios,
  expenseReductionAmount,
  runScenario,
  totalMonthlyContribution,
  type ScenarioConditions,
  type ScenarioInput,
} from './scenario-engine'
import { DEFAULT_HORIZONS, projectAssets } from './projection'
import { OFFICIAL_RETURN_RATES } from './return-assumptions'

const conditions = (patch: Partial<ScenarioConditions> = {}): ScenarioConditions => ({
  baseMonthlyContribution: 60_000,
  additionalMonthlySavings: 0,
  additionalMonthlyInvestment: 0,
  monthlyExpenseReduction: 0,
  monthlyExtraContribution: 0,
  annualReturnRate: 0,
  ...patch,
})

const input = (patch: Partial<ScenarioInput> = {}): ScenarioInput => ({
  currentAssets: 2_400_000,
  targetAssets: 30_000_000,
  startMonth: '2026-09',
  conditions: conditions(),
  ...patch,
})

// ---------------------------------------------------------------- §10 Invariant

test('利回り0%は既存 projection.ts と同じ結果になる', () => {
  const result = runScenario(input({ conditions: conditions({ annualReturnRate: 0 }) }))
  const expected = projectAssets({
    currentAssets: 2_400_000,
    monthlyContribution: 60_000,
    horizons: DEFAULT_HORIZONS,
  })
  assert.deepEqual(result.projection, expected)
})

test('利回り0%の到達月は単純積立と一致する', () => {
  // (3,000万 − 240万) ÷ 6万 = 460ヶ月 = 38年4ヶ月後
  const result = runScenario(input())
  assert.equal(result.monthsToTarget, 460)
  assert.equal(result.projectedTargetMonth, '2065-01')
})

// ---------------------------------------------------------------- §11 到達判定

test('目標が未設定なら null を返す', () => {
  const result = runScenario(input({ targetAssets: null }))
  assert.equal(result.monthsToTarget, null)
  assert.equal(result.projectedTargetMonth, null)
  assert.equal(result.targetReached, false)
})

test('現在資産が不明なら null を返す。0円として計算しない', () => {
  const result = runScenario(input({ currentAssets: null }))
  assert.equal(result.monthsToTarget, null)
  assert.equal(result.projectedTargetMonth, null)
  assert.deepEqual(result.projection, [])
})

test('既存の積立額が不明なら合計も null。0円で埋めない', () => {
  const result = runScenario(
    input({ conditions: conditions({ baseMonthlyContribution: null }) })
  )
  assert.equal(result.monthlyContribution, null)
  assert.equal(result.monthsToTarget, null)
  assert.deepEqual(result.projection, [])
})

test('すでに達成済みなら0ヶ月', () => {
  const result = runScenario(input({ currentAssets: 30_000_000 }))
  assert.equal(result.monthsToTarget, 0)
  assert.equal(result.targetReached, true)
  assert.equal(result.projectedTargetMonth, '2026-09')
})

// ---------------------------------------------------------------- §12 到達不能

test('毎月0円・利回り0%・資産0円なら到達不能', () => {
  const result = runScenario(
    input({
      currentAssets: 0,
      conditions: conditions({ baseMonthlyContribution: 0, annualReturnRate: 0 }),
    })
  )
  assert.equal(result.targetReached, false)
  assert.equal(result.monthsToTarget, null)
})

test('資産0円・積立0円なら利回りがあっても増えない', () => {
  const result = runScenario(
    input({
      currentAssets: 0,
      conditions: conditions({ baseMonthlyContribution: 0, annualReturnRate: 0.07 }),
    })
  )
  assert.equal(result.monthsToTarget, null)
})

test('上限を超える場合は null。無限には回さない', () => {
  const result = runScenario(
    input({
      currentAssets: 0,
      targetAssets: 1_000_000_000_000,
      conditions: conditions({ baseMonthlyContribution: 1, annualReturnRate: 0 }),
    })
  )
  assert.equal(result.monthsToTarget, null)
  assert.ok(MAX_PROJECTION_MONTHS <= 1200)
})

// ---------------------------------------------------------------- §6 二重計上

test('追加分は既存の積立額へ足す。絶対額で置き換えない', () => {
  const c = conditions({
    baseMonthlyContribution: 60_000,
    additionalMonthlySavings: 10_000,
    additionalMonthlyInvestment: 20_000,
    monthlyExpenseReduction: 10_000,
    monthlyExtraContribution: 30_000,
  })
  assert.equal(additionalMonthlyContribution(c), 70_000)
  assert.equal(totalMonthlyContribution(c), 130_000)
})

test('負の追加額は0へ正規化する', () => {
  const c = conditions({
    additionalMonthlySavings: -10_000,
    monthlyExpenseReduction: -5_000,
  })
  assert.equal(additionalMonthlyContribution(c), 0)
  assert.equal(totalMonthlyContribution(c), 60_000)
})

test('負の利回りは0%として扱う', () => {
  const result = runScenario(input({ conditions: conditions({ annualReturnRate: -0.05 }) }))
  assert.equal(result.annualReturnRate, 0)
})

// ---------------------------------------------------------------- §8 比較

test('月1万円追加すると Baseline より早くなる', () => {
  const comparison = compareScenarios({
    baseline: input(),
    adjusted: input({ conditions: conditions({ additionalMonthlySavings: 10_000 }) }),
  })
  assert.ok(comparison.adjusted.monthsToTarget! < comparison.baseline.monthsToTarget!)
  assert.ok(comparison.monthsSaved! > 0)
  assert.equal(comparison.adjusted.additionalMonthlyContribution, 10_000)
})

test('条件を変えなければ短縮は0ヶ月', () => {
  const comparison = compareScenarios({ baseline: input(), adjusted: input() })
  assert.equal(comparison.monthsSaved, 0)
})

test('どちらかが到達しないなら短縮月数は言わない', () => {
  const comparison = compareScenarios({
    baseline: input({
      currentAssets: 0,
      conditions: conditions({ baseMonthlyContribution: 0 }),
    }),
    adjusted: input({
      currentAssets: 0,
      conditions: conditions({ baseMonthlyContribution: 0, additionalMonthlySavings: 100_000 }),
    }),
  })
  assert.equal(comparison.baseline.monthsToTarget, null)
  assert.ok(comparison.adjusted.monthsToTarget !== null)
  assert.equal(comparison.monthsSaved, null)
})

// ---------------------------------------------------------------- §9 複利

test('3% / 5% / 7% は複利で効く', () => {
  const results = [0, 0.03, 0.05, 0.07].map(rate =>
    runScenario(input({ conditions: conditions({ annualReturnRate: rate }) }))
  )
  const months = results.map(r => r.monthsToTarget!)
  // 利回りが高いほど早い
  assert.deepEqual(months, [...months].sort((a, b) => b - a))
  // 0%と同じ結果にならない
  assert.ok(months[1] < months[0])
})

test('複利では「うち積立」より予測資産が大きい', () => {
  const result = runScenario(input({ conditions: conditions({ annualReturnRate: 0.05 }) }))
  const tenYears = result.projection.find(p => p.years === 10)
  assert.ok(tenYears)
  assert.ok(tenYears!.projectedAssets > 2_400_000 + tenYears!.contributed)
})

// ---------------------------------------------------------------- §14 支出削減

test('支出削減の効果額は 現在額 × 削減率', () => {
  // タバコ ¥18,000/月 を50%減らす → ¥9,000/月
  assert.equal(expenseReductionAmount(18_000, 0.5), 9_000)
  assert.equal(expenseReductionAmount(18_000, 1), 18_000)
})

test('削減率は0〜1に収める', () => {
  assert.equal(expenseReductionAmount(18_000, 1.5), 18_000)
  assert.equal(expenseReductionAmount(18_000, -1), 0)
  assert.equal(expenseReductionAmount(-100, 0.5), 0)
})

test('削減率の選択肢は 25 / 50 / 75 / 100%', () => {
  assert.deepEqual([...EXPENSE_REDUCTION_RATIOS], [0.25, 0.5, 0.75, 1])
})

test('支出削減は毎月の積立へそのまま乗る', () => {
  const reduction = expenseReductionAmount(20_000, 0.5)
  const c = conditions({ monthlyExpenseReduction: reduction })
  assert.equal(totalMonthlyContribution(c), 70_000)
})

// ---------------------------------------------------------------- §16 副業

test('副業収入は指定した額だけが積立へ入る', () => {
  // 指定しなければ0。勝手に「副業収入を全部投資する」と決めない
  assert.equal(totalMonthlyContribution(conditions()), 60_000)
  assert.equal(
    totalMonthlyContribution(conditions({ monthlyExtraContribution: 50_000 })),
    110_000
  )
})

// ---------------------------------------------------------------- §30 Invariant

test('条件が改善したのに到達が遅くなることはない', () => {
  const rates = [0, 0.03, 0.05, 0.07]
  const additions = [0, 10_000, 50_000, 100_000]

  for (let r = 0; r < rates.length; r++) {
    for (let a = 0; a < additions.length; a++) {
      const weaker = runScenario(
        input({
          conditions: conditions({
            annualReturnRate: rates[r],
            additionalMonthlySavings: additions[a],
          }),
        })
      )
      // 利回りも追加額も同じか大きい条件は、必ず同じか早く到達する
      for (let r2 = r; r2 < rates.length; r2++) {
        for (let a2 = a; a2 < additions.length; a2++) {
          const stronger = runScenario(
            input({
              conditions: conditions({
                annualReturnRate: rates[r2],
                additionalMonthlySavings: additions[a2],
              }),
            })
          )
          if (weaker.monthsToTarget === null || stronger.monthsToTarget === null) continue
          assert.ok(
            stronger.monthsToTarget <= weaker.monthsToTarget,
            `利回り${rates[r2]} 追加${additions[a2]} が 利回り${rates[r]} 追加${additions[a]} より遅い`
          )
        }
      }
    }
  }
})

// ---------------------------------------------------------------- §3 / §33 比較セット

test('正式シナリオ 0/3/5/7% と Custom を並べる', () => {
  const set = buildScenarioComparisonSet({
    currentAssets: 2_400_000,
    targetAssets: 30_000_000,
    startMonth: '2026-09',
    baseMonthlyContribution: 60_000,
    adjustments: {
      additionalMonthlySavings: 10_000,
      additionalMonthlyInvestment: 0,
      monthlyExpenseReduction: 0,
      monthlyExtraContribution: 30_000,
    },
    selectedReturnRate: 0.04,
  })

  assert.deepEqual(
    set.byReturnRate.map(c => c.annualReturnRate),
    [0, 0.03, 0.04, 0.05, 0.07]
  )
  assert.equal(set.byReturnRate.find(c => c.annualReturnRate === 0.04)?.isOfficialRate, false)
  for (const rate of OFFICIAL_RETURN_RATES) {
    assert.equal(set.byReturnRate.find(c => c.annualReturnRate === rate)?.isOfficialRate, true)
  }
  assert.equal(set.selected.annualReturnRate, 0.04)
  assert.equal(set.additionalMonthlyContribution, 40_000)
})

test('Baseline には条件変更を入れない', () => {
  const set = buildScenarioComparisonSet({
    currentAssets: 2_400_000,
    targetAssets: 30_000_000,
    startMonth: '2026-09',
    baseMonthlyContribution: 60_000,
    adjustments: {
      additionalMonthlySavings: 40_000,
      additionalMonthlyInvestment: 0,
      monthlyExpenseReduction: 0,
      monthlyExtraContribution: 0,
    },
    selectedReturnRate: 0,
  })
  assert.equal(set.selected.baseline.monthlyContribution, 60_000)
  assert.equal(set.selected.adjusted.monthlyContribution, 100_000)
  assert.equal(set.selected.baseline.additionalMonthlyContribution, 0)
})

test('横軸は両シナリオで共通で、到達年をカバーする', () => {
  const set = buildScenarioComparisonSet({
    currentAssets: 2_400_000,
    targetAssets: 30_000_000,
    startMonth: '2026-09',
    baseMonthlyContribution: 60_000,
    adjustments: {
      additionalMonthlySavings: 0,
      additionalMonthlyInvestment: 0,
      monthlyExpenseReduction: 0,
      monthlyExtraContribution: 0,
    },
    selectedReturnRate: 0,
  })
  const years = set.horizons[set.horizons.length - 1]
  assert.ok(years >= Math.ceil(set.selected.baseline.monthsToTarget! / 12) || years === 40)
  assert.deepEqual(
    set.selected.baseline.projection.map(p => p.years),
    set.horizons
  )
  assert.deepEqual(
    set.selected.adjusted.projection.map(p => p.years),
    set.horizons
  )
})

test('目標が無くても比較セットは壊れない', () => {
  const set = buildScenarioComparisonSet({
    currentAssets: 2_400_000,
    targetAssets: null,
    startMonth: '2026-09',
    baseMonthlyContribution: 60_000,
    adjustments: {
      additionalMonthlySavings: 10_000,
      additionalMonthlyInvestment: 0,
      monthlyExpenseReduction: 0,
      monthlyExtraContribution: 0,
    },
    selectedReturnRate: 0.03,
  })
  assert.equal(set.selected.baseline.monthsToTarget, null)
  assert.equal(set.selected.monthsSaved, null)
  assert.ok(set.selected.adjusted.projection.length > 0)
})
