// lib/services/scenario-engine.ts
//
// 「条件を変えると目標到達がどう変わるか」の計算（スペック §1〜§13）。純関数。
//
// I/O・`new Date()`・DB・AI を持たない。利回りはすべて **仮定** であり、
// 保証ではない。画面へ「確実に」「必ず」と読める表現を出さないこと。
//
// 二重計上を避ける約束（スペック §6）:
//   baseMonthlyContribution … 既存 asset-planning の monthlyAssetContribution
//                             （通常貯金 + 資産形成）。Baseline はこれを再利用する
//   additional*             … そこへ **追加** する分だけ
//
// 4つの入力をどれも「今いくら貯金しているか」の絶対額にすると、Baseline の
// 貯金と二重に数えてしまう。だから絶対額ではなく追加額で受け取る。
import { addMonthsToMonth } from './goal-progress'
import { nonNegativeYen, yen } from './money'
import { DEFAULT_HORIZONS, projectAssets, type ProjectionPoint } from './projection'
import {
  OFFICIAL_RETURN_RATES,
  isOfficialReturnRate,
  monthlyRateFrom,
} from './return-assumptions'

/**
 * 月数を「38年4ヶ月」の表示にする。
 *
 * 整形だけで、月数そのものは monthsToTarget が出したもの。
 * 到達しない場合の言い方は画面ごとに違うので、null は呼び出し側が扱う。
 */
export function formatMonthsDuration(months: number): string {
  if (months <= 0) return '達成済み'
  const years = Math.floor(months / 12)
  const rest = months % 12
  if (years === 0) return `${rest}ヶ月`
  if (rest === 0) return `${years}年`
  return `${years}年${rest}ヶ月`
}

/** 到達しない条件で無限に回さないための上限（100年） */
export const MAX_PROJECTION_MONTHS = 1200

/** 支出削減シナリオで選べる削減率（スペック §14） */
export const EXPENSE_REDUCTION_RATIOS = [0.25, 0.5, 0.75, 1] as const

export type ScenarioConditions = {
  /**
   * 現在すでに毎月積み立てている額。既存 monthlyAssetContribution を渡す。
   * 算出できないなら null（0円と区別する）。
   */
  baseMonthlyContribution: number | null
  /** 追加で貯金へ回す額 */
  additionalMonthlySavings: number
  /** 追加で投資へ回す額 */
  additionalMonthlyInvestment: number
  /** 支出削減で浮いた額のうち、資産形成へ回す額 */
  monthlyExpenseReduction: number
  /**
   * 副業・追加収入のうち、資産形成へ回す額（スペック §16 / §24）。
   *
   * 「副業収入を全部投資する」とここで決めない。ユーザーがシナリオの条件として
   * 指定した額だけが入る。FIRE後に続く収入（postFireMonthlyIncome）とは別物。
   */
  monthlyExtraContribution: number
  /** 想定利回り（年）。仮定であって保証ではない */
  annualReturnRate: number
}

export type ScenarioInput = {
  /** 現在の総資産。分からないなら null */
  currentAssets: number | null
  /** 目標額。未設定なら null */
  targetAssets: number | null
  /** 'YYYY-MM' */
  startMonth: string
  conditions: ScenarioConditions
  /** 予測を出す年数。既定は既存 projection と同じ */
  horizons?: number[]
}

export type ScenarioResult = {
  /** 毎月の積立額の合計。既存分が不明なら null */
  monthlyContribution: number | null
  /** 条件変更で増えた分だけ */
  additionalMonthlyContribution: number
  annualReturnRate: number
  currentAssets: number | null
  targetAssets: number | null
  targetReached: boolean
  /** 到達までの月数。目標・現在資産が不明、または到達しないなら null */
  monthsToTarget: number | null
  /** 到達予定月 'YYYY-MM' */
  projectedTargetMonth: string | null
  projection: ProjectionPoint[]
}

/** 条件変更で増える毎月の積立額。負の入力は0へ正規化する（スペック §29） */
export function additionalMonthlyContribution(conditions: ScenarioConditions): number {
  return (
    nonNegativeYen(conditions.additionalMonthlySavings) +
    nonNegativeYen(conditions.additionalMonthlyInvestment) +
    nonNegativeYen(conditions.monthlyExpenseReduction) +
    nonNegativeYen(conditions.monthlyExtraContribution)
  )
}

/**
 * 毎月の積立額の合計。
 * 既存分が不明なら null。0円で埋めると「積立していない」と断言することになる。
 */
export function totalMonthlyContribution(conditions: ScenarioConditions): number | null {
  if (conditions.baseMonthlyContribution === null) return null
  return (
    Math.max(yen(conditions.baseMonthlyContribution), 0) +
    additionalMonthlyContribution(conditions)
  )
}

/**
 * 支出削減の効果額（スペック §14）。
 *
 *   タバコ ¥18,000/月 を50%減らす → ¥9,000/月
 *
 * Expense Intelligence は「今いくら使っているか」までを出す。ここは
 * 「減らしたらいくら浮くか」だけを出し、削るべきかは判断しない。
 */
export function expenseReductionAmount(
  currentMonthlyExpense: number,
  reductionRatio: number
): number {
  const expense = nonNegativeYen(currentMonthlyExpense)
  const ratio = Math.min(Math.max(Number(reductionRatio) || 0, 0), 1)
  return Math.round(expense * ratio)
}

/**
 * 月次複利で months ヶ月後の資産。
 *
 *   assets = assets × (1 + 月利) + 毎月の積立
 *
 * 途中で円へ丸めない。毎月丸めると誤差が積み上がって、同じ条件でも
 * 期間の切り方で結果が変わる。丸めるのは出力の一度だけ。
 */
function simulate(
  currentAssets: number,
  monthlyContribution: number,
  monthlyRate: number,
  months: number
): number {
  let assets = currentAssets
  for (let month = 0; month < months; month++) {
    assets = assets * (1 + monthlyRate) + monthlyContribution
  }
  return assets
}

/**
 * 目標へ到達する月数。到達しないなら null（スペック §12）。
 * 上限を必ず持たせ、到達しない条件で無限に回さない。
 */
function monthsToReach(
  currentAssets: number,
  targetAssets: number,
  monthlyContribution: number,
  monthlyRate: number
): number | null {
  if (currentAssets >= targetAssets) return 0
  // 増える要素が何も無ければ、何ヶ月回しても届かない
  if (monthlyContribution <= 0 && (monthlyRate <= 0 || currentAssets <= 0)) return null

  let assets = currentAssets
  for (let month = 1; month <= MAX_PROJECTION_MONTHS; month++) {
    assets = assets * (1 + monthlyRate) + monthlyContribution
    if (assets >= targetAssets) return month
  }
  return null
}

/**
 * 節目ごとの予測資産。
 *
 * **利回り0%では既存 projection.ts をそのまま使う**（スペック §10）。
 * 同じ単純積立の式を2つ持たないため、0%の分岐で複利側へ流さない。
 */
function projectPoints(
  currentAssets: number | null,
  monthlyContribution: number,
  annualReturnRate: number,
  horizons: number[]
): ProjectionPoint[] {
  const monthlyRate = monthlyRateFrom(annualReturnRate)
  if (monthlyRate === 0) {
    return projectAssets({ currentAssets, monthlyContribution, horizons })
  }
  if (currentAssets === null) return []

  const current = yen(currentAssets)
  return horizons.map(years => {
    const months = Math.round(years * 12)
    return {
      years,
      months,
      projectedAssets: yen(simulate(current, monthlyContribution, monthlyRate, months)),
      // 「うち積立」は元本の累計。運用益と混ぜない
      contributed: monthlyContribution * months,
    }
  })
}

export function runScenario(input: ScenarioInput): ScenarioResult {
  const { conditions } = input
  const monthlyContribution = totalMonthlyContribution(conditions)
  const annualReturnRate = Math.max(Number(conditions.annualReturnRate) || 0, 0)
  const currentAssets = input.currentAssets === null ? null : yen(input.currentAssets)
  const targetAssets = input.targetAssets === null ? null : yen(input.targetAssets)

  const base: Omit<ScenarioResult, 'targetReached' | 'monthsToTarget' | 'projectedTargetMonth'> = {
    monthlyContribution,
    additionalMonthlyContribution: additionalMonthlyContribution(conditions),
    annualReturnRate,
    currentAssets,
    targetAssets,
    projection:
      monthlyContribution === null
        ? []
        : projectPoints(
            currentAssets,
            monthlyContribution,
            annualReturnRate,
            input.horizons ?? DEFAULT_HORIZONS
          ),
  }

  // 目標・現在資産・既存の積立額のどれかが分からなければ到達判定はしない
  if (targetAssets === null || currentAssets === null || monthlyContribution === null) {
    return { ...base, targetReached: false, monthsToTarget: null, projectedTargetMonth: null }
  }

  const months = monthsToReach(
    currentAssets,
    targetAssets,
    monthlyContribution,
    monthlyRateFrom(annualReturnRate)
  )

  return {
    ...base,
    targetReached: months !== null,
    monthsToTarget: months,
    projectedTargetMonth: months === null ? null : addMonthsToMonth(input.startMonth, months),
  }
}

export type ScenarioComparison = {
  annualReturnRate: number
  /** 正式シナリオ(0/3/5/7%)か、ユーザー指定の Custom か */
  isOfficialRate: boolean
  baseline: ScenarioResult
  adjusted: ScenarioResult
  /** 短縮月数。どちらかが到達しないなら null（数字で言えない） */
  monthsSaved: number | null
}

export function compareScenarios(input: {
  baseline: ScenarioInput
  adjusted: ScenarioInput
}): ScenarioComparison {
  const baseline = runScenario(input.baseline)
  const adjusted = runScenario(input.adjusted)

  return {
    annualReturnRate: adjusted.annualReturnRate,
    isOfficialRate: isOfficialReturnRate(adjusted.annualReturnRate),
    baseline,
    adjusted,
    monthsSaved:
      baseline.monthsToTarget === null || adjusted.monthsToTarget === null
        ? null
        : baseline.monthsToTarget - adjusted.monthsToTarget,
  }
}

export type ScenarioComparisonSet = {
  startMonth: string
  currentAssets: number | null
  targetAssets: number | null
  baseMonthlyContribution: number | null
  additionalMonthlyContribution: number
  selectedReturnRate: number
  /** 選択中の利回りでの比較。画面の主表示 */
  selected: ScenarioComparison
  /** 正式シナリオ + Custom。利回り昇順 */
  byReturnRate: ScenarioComparison[]
  /** チャートの横軸。両シナリオで共通の年数 */
  horizons: number[]
}

/**
 * チャートの横軸に使う年数。
 * 到達年までは見せたいが、100年分の折れ線は読めないので上限を置く。
 */
function chartHorizons(monthsCandidates: Array<number | null>): number[] {
  const reached = monthsCandidates.filter((m): m is number => m !== null)
  const years = reached.length === 0 ? 10 : Math.ceil(Math.max(...reached) / 12)
  const capped = Math.min(Math.max(years, 5), 40)
  return Array.from({ length: capped }, (_, index) => index + 1)
}

/**
 * Baseline と変更後を、正式シナリオの利回りごとに比較する（スペック §3 / §33）。
 * 保存はしない。入力から毎回計算する（スペック §25）。
 */
export function buildScenarioComparisonSet(input: {
  currentAssets: number | null
  targetAssets: number | null
  startMonth: string
  /** 既存の毎月の積立額。算出できないなら null */
  baseMonthlyContribution: number | null
  /** ユーザーが指定した条件変更。Baseline では使わない */
  adjustments: Omit<ScenarioConditions, 'baseMonthlyContribution' | 'annualReturnRate'>
  /** 選択中の想定利回り */
  selectedReturnRate: number
  /** 比較に並べる利回り。既定は正式シナリオ */
  returnRates?: readonly number[]
}): ScenarioComparisonSet {
  const noAdjustment = {
    additionalMonthlySavings: 0,
    additionalMonthlyInvestment: 0,
    monthlyExpenseReduction: 0,
    monthlyExtraContribution: 0,
  }

  const conditionsFor = (annualReturnRate: number, adjusted: boolean): ScenarioConditions => ({
    baseMonthlyContribution: input.baseMonthlyContribution,
    ...(adjusted ? input.adjustments : noAdjustment),
    annualReturnRate,
  })

  const comparisonAt = (annualReturnRate: number, horizons: number[]): ScenarioComparison =>
    compareScenarios({
      baseline: {
        currentAssets: input.currentAssets,
        targetAssets: input.targetAssets,
        startMonth: input.startMonth,
        conditions: conditionsFor(annualReturnRate, false),
        horizons,
      },
      adjusted: {
        currentAssets: input.currentAssets,
        targetAssets: input.targetAssets,
        startMonth: input.startMonth,
        conditions: conditionsFor(annualReturnRate, true),
        horizons,
      },
    })

  // 横軸は選択中の利回りでの到達年に合わせる。先に到達月だけを見て決める
  const probe = comparisonAt(input.selectedReturnRate, DEFAULT_HORIZONS)
  const horizons = chartHorizons([probe.baseline.monthsToTarget, probe.adjusted.monthsToTarget])

  const rates = [
    ...new Set<number>([
      ...(input.returnRates ?? OFFICIAL_RETURN_RATES),
      input.selectedReturnRate,
    ]),
  ].sort((a, b) => a - b)

  const byReturnRate = rates.map(rate => comparisonAt(rate, horizons))
  const selected =
    byReturnRate.find(c => c.annualReturnRate === input.selectedReturnRate) ??
    comparisonAt(input.selectedReturnRate, horizons)

  return {
    startMonth: input.startMonth,
    currentAssets: input.currentAssets,
    targetAssets: input.targetAssets,
    baseMonthlyContribution: input.baseMonthlyContribution,
    additionalMonthlyContribution: selected.adjusted.additionalMonthlyContribution,
    selectedReturnRate: input.selectedReturnRate,
    selected,
    byReturnRate,
    horizons,
  }
}
