// lib/services/fire-planner-loader.ts
//
// FIRE Planner の収集(I/O)。
//
// **新しい金融式をここに書かない。** 現在資産・毎月の積立額・必須生活費は
// すべて既存の asset-planning が出した値を使い、FIRE 固有の逆算だけを
// fire-planner.ts の純関数へ渡す。
//
// 生活費が未入力のときは、防衛資金で使っている必須生活費
// （生活固定費 + 変動費予算）をそのまま推定値にする。FIRE 用に別の
// 生活費の定義を作ると、同じ画面の中で数字が食い違う。
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAssetPlanning, type AssetPlanningLoad } from './asset-planning-loader'
import {
  DEFAULT_TAX_RATE,
  buildFirePlan,
  isFireType,
  type FirePlan,
  type FireSettings,
} from './fire-planner'
import { DEFAULT_RETURN_RATE } from './return-assumptions'

export type StoredFireSettings = FireSettings & {
  /** 行がまだ無い（既定値で表示している）状態 */
  isDefault: boolean
}

/** 行が無いユーザーでも画面が壊れないよう、既定値を返す */
export function defaultFireSettings(): StoredFireSettings {
  return {
    fireType: 'semi',
    monthlyLivingCost: null,
    postFireMonthlyIncome: 0,
    targetAssetIncomeMonthly: null,
    assumedReturnRate: DEFAULT_RETURN_RATE,
    taxRate: DEFAULT_TAX_RATE,
    isDefault: true,
  }
}

export async function loadFireSettings(
  userId: string,
  client: SupabaseClient
): Promise<StoredFireSettings> {
  const { data, error } = await client
    .from('fire_settings')
    .select(
      'fire_type, monthly_living_cost, post_fire_monthly_income, target_asset_income_monthly, assumed_return_rate, tax_rate'
    )
    .eq('user_id', userId)
    .maybeSingle()

  // 取得失敗を「未設定」として扱うと、ユーザーが入れた生活費を無視した
  // 必要資産を正式値として表示してしまう
  if (error) throw new Error(`fire_settings の取得に失敗しました: ${error.message}`)
  if (!data) return defaultFireSettings()

  return {
    fireType: isFireType(data.fire_type) ? data.fire_type : 'semi',
    monthlyLivingCost:
      data.monthly_living_cost === null || data.monthly_living_cost === undefined
        ? null
        : Number(data.monthly_living_cost),
    postFireMonthlyIncome: Number(data.post_fire_monthly_income ?? 0),
    targetAssetIncomeMonthly:
      data.target_asset_income_monthly === null || data.target_asset_income_monthly === undefined
        ? null
        : Number(data.target_asset_income_monthly),
    assumedReturnRate: Number(data.assumed_return_rate ?? DEFAULT_RETURN_RATE),
    taxRate: Number(data.tax_rate ?? DEFAULT_TAX_RATE),
    isDefault: false,
  }
}

export type FirePlanLoad = {
  plan: FirePlan
  settings: StoredFireSettings
}

/**
 * 設定と、既に読み込んだ asset-planning から FirePlan を組み立てる。
 *
 * Scenario Engine も FIRE の必要資産を目標として使うので（スペック §23 / §31）、
 * 生活費のフォールバックを2箇所に書かないためここへ切り出す。
 * loadAssetPlanning を2回呼ばないよう、読み込み済みの結果を受け取る。
 */
export function composeFirePlan(
  settings: StoredFireSettings,
  assetPlanning: AssetPlanningLoad,
  month: string
): FirePlan {
  // 生活費の推定は「家計側の必須生活費」を借りるだけ。ここで組み立て直さない
  const estimatedLivingCost = assetPlanning.plan.emergencyFund.monthlyEssentialExpenses
  const usesEstimate = settings.monthlyLivingCost === null && estimatedLivingCost !== null

  return buildFirePlan({
    settings: usesEstimate ? { ...settings, monthlyLivingCost: estimatedLivingCost } : settings,
    livingCostSource: usesEstimate ? 'budget' : 'user',
    currentAssets: assetPlanning.assets.totalAssets,
    monthlyContribution: assetPlanning.plan.monthlyAssetContribution,
    asOfMonth: month,
  })
}

export async function loadFirePlan(
  userId: string,
  month: string,
  today: string,
  client: SupabaseClient
): Promise<FirePlanLoad> {
  const [settings, assetPlanning] = await Promise.all([
    loadFireSettings(userId, client),
    loadAssetPlanning(userId, month, today, client),
  ])

  return { settings, plan: composeFirePlan(settings, assetPlanning, month) }
}
