// lib/services/fire-planner.ts
//
// FIRE（経済的自立）に必要な資産の逆算。純関数（スペック §20〜§22）。
//
//   必要な資産収入（手取り）= 生活費 − 副業・事業収入
//   必要な資産収入（税引前）= 手取り ÷ (1 − 税率)
//   必要資産                = 税引前の年額 ÷ 想定利回り
//
// 利回りは **すべて仮定** として扱う。ここが出すのは「その仮定が続いた場合の
// 必要額」であって、達成・利回りの保証ではない。文言でも保証表現は使わない。
//
// 新しい生活費の定義をここで作らない。生活費が未入力のときに何を代わりに
// 使うかは呼び出し側（Loader）が決め、この関数は渡された値だけを使う。
import { addMonthsToMonth } from './goal-progress'
import { yen } from './money'

export const FIRE_TYPES = ['full', 'semi'] as const
export type FireType = (typeof FIRE_TYPES)[number]

export const FIRE_TYPE_LABEL: Record<FireType, string> = {
  full: '完全FIRE',
  semi: '半FIRE',
}

export const FIRE_TYPE_DESCRIPTION: Record<FireType, string> = {
  full: '生活費のすべてを資産収入で賄います',
  semi: '生活費を資産収入と副業・事業収入で賄います',
}

export function isFireType(value: unknown): value is FireType {
  return typeof value === 'string' && (FIRE_TYPES as readonly string[]).includes(value)
}

/**
 * 正式シナリオの利回り（スペック §22）。
 * これ以外の利回りは Custom Scenario として扱い、正式値と混ぜない。
 */
export const OFFICIAL_RETURN_RATES = [0, 0.03, 0.05, 0.07] as const

/** 上場株式等の申告分離課税（所得税・住民税・復興特別所得税） */
export const DEFAULT_TAX_RATE = 0.20315

/** 想定利回りの既定値。いわゆる4%ルールに合わせる（あくまで仮定） */
export const DEFAULT_RETURN_RATE = 0.04

export type FireSettings = {
  fireType: FireType
  /** 月の生活費。未入力なら null（0円ではない） */
  monthlyLivingCost: number | null
  /** 副業・事業収入。完全FIREでは計算に使わない */
  sideIncomeMonthly: number
  /** ユーザーが直接指定した資産収入目標。null なら生活費から逆算する */
  targetAssetIncomeMonthly: number | null
  assumedReturnRate: number
  taxRate: number
}

export type FireScenario = {
  returnRate: number
  /** 正式シナリオ（0/3/5/7%）か、ユーザー指定の Custom か */
  isOfficial: boolean
  /** 必要資産。算出できない場合は null（0円と区別する） */
  requiredAssets: number | null
  /** 必要資産に対する現在資産の充足率。算出できないなら null */
  fundedRatio: number | null
  /** 不足額。足りていれば0。算出できないなら null */
  shortfall: number | null
}

export type FirePlan = {
  fireType: FireType
  fireTypeLabel: string
  monthlyLivingCost: number | null
  /** 生活費をユーザー入力から取ったか、家計から推定したか */
  livingCostSource: 'user' | 'budget' | 'unknown'
  sideIncomeMonthly: number
  /** 資産収入目標をユーザーが直接指定したか、生活費から逆算したか */
  assetIncomeSource: 'user' | 'derived' | 'unknown'
  /** 毎月必要な資産収入（手取り）。算出できないなら null */
  requiredMonthlyAssetIncome: number | null
  /** 年間で必要な資産収入（税引前）。算出できないなら null */
  requiredAnnualAssetIncomeGross: number | null
  taxRate: number
  assumedReturnRate: number
  /** 想定利回りでのシナリオ。画面の主表示はこれ */
  primary: FireScenario
  /** 正式シナリオ + Custom。利回り昇順 */
  scenarios: FireScenario[]
  currentAssets: number | null
  /** 利回り0%・現在の積立ペースで必要資産へ到達する月。到達しないなら null */
  zeroReturnAchievementMonth: string | null
  /** 副業収入だけで生活費を賄えている状態 */
  coveredBySideIncome: boolean
  missingData: string[]
}

/**
 * 毎月必要な資産収入（手取り）。
 *
 * 完全FIRE は副業収入を当てにしない。半FIRE は生活費から副業収入を引く。
 * 副業収入が生活費を超えている場合は 0 を返す（「資産収入は要らない」は
 * 事実として 0 円であり、算出不能の null とは別物）。
 */
export function requiredMonthlyAssetIncome(settings: FireSettings): number | null {
  if (settings.targetAssetIncomeMonthly !== null) {
    return Math.max(yen(settings.targetAssetIncomeMonthly), 0)
  }
  if (settings.monthlyLivingCost === null) return null

  const living = Math.max(yen(settings.monthlyLivingCost), 0)
  if (settings.fireType === 'full') return living

  const side = Math.max(yen(settings.sideIncomeMonthly), 0)
  return Math.max(living - side, 0)
}

/**
 * 手取りで必要な月額から、税引前の年額を出す。
 * 税を無視すると必要資産を実態より小さく見積もることになるので、
 * 税率が入っているときは必ず割り戻す。
 */
export function grossAnnualAssetIncome(
  monthlyNet: number | null,
  taxRate: number
): number | null {
  if (monthlyNet === null) return null
  const rate = Math.min(Math.max(taxRate, 0), 0.999)
  return Math.round((Math.max(monthlyNet, 0) * 12) / (1 - rate))
}

/**
 * 必要資産 = 税引前の年額 ÷ 利回り。
 *
 * 利回り0%では資産収入が発生しないため、必要資産は「無限」であって
 * 0円でも巨大な有限額でもない。ここは null を返し、画面では
 * 「この仮定では賄えません」と出す。
 */
export function requiredAssetsFor(
  grossAnnual: number | null,
  returnRate: number
): number | null {
  if (grossAnnual === null) return null
  if (grossAnnual === 0) return 0
  if (!Number.isFinite(returnRate) || returnRate <= 0) return null
  return Math.round(grossAnnual / returnRate)
}

function buildScenario(
  returnRate: number,
  grossAnnual: number | null,
  currentAssets: number | null
): FireScenario {
  const requiredAssets = requiredAssetsFor(grossAnnual, returnRate)
  const isOfficial = OFFICIAL_RETURN_RATES.some(rate => rate === returnRate)

  if (requiredAssets === null || currentAssets === null) {
    return { returnRate, isOfficial, requiredAssets, fundedRatio: null, shortfall: null }
  }
  if (requiredAssets === 0) {
    return { returnRate, isOfficial, requiredAssets: 0, fundedRatio: 1, shortfall: 0 }
  }
  return {
    returnRate,
    isOfficial,
    requiredAssets,
    fundedRatio: currentAssets / requiredAssets,
    shortfall: Math.max(requiredAssets - currentAssets, 0),
  }
}

export type FirePlanInput = {
  settings: FireSettings
  livingCostSource: 'user' | 'budget' | 'unknown'
  /** 現在の総資産。分からないなら null */
  currentAssets: number | null
  /** 毎月の積立額（通常貯金 + 資産形成）。分からないなら null */
  monthlyContribution: number | null
  /** 'YYYY-MM' */
  asOfMonth: string
}

export function buildFirePlan(input: FirePlanInput): FirePlan {
  const { settings } = input
  const missingData: string[] = []

  const monthlyNet = requiredMonthlyAssetIncome(settings)
  if (settings.monthlyLivingCost === null && settings.targetAssetIncomeMonthly === null) {
    missingData.push('月の生活費が未入力のため、必要な資産収入を計算できません')
  }
  if (input.currentAssets === null) {
    missingData.push('総資産が分からないため、不足額を計算できません')
  }

  const grossAnnual = grossAnnualAssetIncome(monthlyNet, settings.taxRate)
  const currentAssets = input.currentAssets === null ? null : yen(input.currentAssets)

  const rates = [...new Set<number>([...OFFICIAL_RETURN_RATES, settings.assumedReturnRate])].sort(
    (a, b) => a - b
  )
  const scenarios = rates.map(rate => buildScenario(rate, grossAnnual, currentAssets))
  const primary =
    scenarios.find(s => s.returnRate === settings.assumedReturnRate) ??
    buildScenario(settings.assumedReturnRate, grossAnnual, currentAssets)

  if (primary.requiredAssets === null && grossAnnual !== null && grossAnnual > 0) {
    missingData.push('想定利回りが0%のため、資産収入だけでは生活費を賄えません')
  }

  return {
    fireType: settings.fireType,
    fireTypeLabel: FIRE_TYPE_LABEL[settings.fireType],
    monthlyLivingCost:
      settings.monthlyLivingCost === null ? null : yen(settings.monthlyLivingCost),
    livingCostSource: settings.monthlyLivingCost === null ? 'unknown' : input.livingCostSource,
    sideIncomeMonthly: Math.max(yen(settings.sideIncomeMonthly), 0),
    assetIncomeSource:
      settings.targetAssetIncomeMonthly !== null
        ? 'user'
        : monthlyNet === null
          ? 'unknown'
          : 'derived',
    requiredMonthlyAssetIncome: monthlyNet,
    requiredAnnualAssetIncomeGross: grossAnnual,
    taxRate: settings.taxRate,
    assumedReturnRate: settings.assumedReturnRate,
    primary,
    scenarios,
    currentAssets,
    zeroReturnAchievementMonth: zeroReturnAchievementMonth({
      requiredAssets: primary.requiredAssets,
      currentAssets,
      monthlyContribution: input.monthlyContribution,
      asOfMonth: input.asOfMonth,
    }),
    coveredBySideIncome:
      settings.fireType === 'semi' &&
      settings.targetAssetIncomeMonthly === null &&
      monthlyNet === 0,
    missingData,
  }
}

/**
 * 現在の積立ペースで必要資産へ到達する月。
 *
 * ここは **利回り0%の単純積立**（既存 projection と同じ前提）で出す。
 * 必要資産の側は利回りの仮定を置いているが、到達時期に複利を載せた予測は
 * Scenario Engine（Phase 5C）の担当。ここで二重に仮定を重ねない。
 */
export function zeroReturnAchievementMonth(input: {
  requiredAssets: number | null
  currentAssets: number | null
  monthlyContribution: number | null
  asOfMonth: string
}): string | null {
  const { requiredAssets, currentAssets, monthlyContribution } = input
  if (requiredAssets === null || currentAssets === null) return null
  if (currentAssets >= requiredAssets) return input.asOfMonth
  if (monthlyContribution === null || monthlyContribution <= 0) return null
  return addMonthsToMonth(
    input.asOfMonth,
    Math.ceil((requiredAssets - currentAssets) / monthlyContribution)
  )
}
