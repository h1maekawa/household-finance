// lib/services/asset-summary-loader.ts
//
// 総資産の唯一の集計元（I/O）。
//
// Home / Assets / Projection が別々に資産を数えると必ずズレるので、ここへ集約する。
// 計算らしい計算は「足す」だけで、評価額の算出は既存の lib/stock.ts などに任せる。
//
// Debt は引いていない。したがってこれは「総資産」であって「純資産 / Net Worth」
// ではない。UI でもその名前を使わないこと。
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { stockCurrentValue } from './asset-value'
import { loadLiquidCash } from './liquid-cash-loader'
import type { LiquidCash } from './liquid-cash'
import { yen } from './money'

export type AssetSummary = {
  /** 現金・預金・電子マネー。未登録なら null */
  liquidCash: number | null
  stockValue: number
  fundValue: number
  otherAssets: number
  /** 総資産。流動現金が不明なら null（推測で0にしない） */
  totalAssets: number | null
  liquidCashSource: LiquidCash['source']
  recordedAt: string | null
}

export async function loadAssetSummary(
  userId: string,
  client?: SupabaseClient
): Promise<AssetSummary> {
  const supabase = client ?? (await createSupabaseServerClient())

  const [liquid, stocksRes, fundsRes] = await Promise.all([
    loadLiquidCash(userId, supabase),
    supabase.from('stock_holdings').select('*').eq('user_id', userId),
    supabase.from('fund_holdings').select('current_value').eq('user_id', userId),
  ])

  // 取得失敗を0円として資産に混ぜない
  if (stocksRes.error) throw new Error(`stock_holdings の取得に失敗しました: ${stocksRes.error.message}`)
  if (fundsRes.error) throw new Error(`fund_holdings の取得に失敗しました: ${fundsRes.error.message}`)

  const stockValue = (stocksRes.data ?? []).reduce(
    (sum, holding) => sum + stockCurrentValue(holding),
    0
  )
  const fundValue = (fundsRes.data ?? []).reduce(
    (sum, fund) => sum + Number(fund.current_value ?? 0),
    0
  )

  return {
    liquidCash: liquid.amount,
    stockValue: yen(stockValue),
    fundValue: yen(fundValue),
    otherAssets: 0,
    totalAssets: liquid.amount === null ? null : yen(liquid.amount + stockValue + fundValue),
    liquidCashSource: liquid.source,
    recordedAt: liquid.recordedAt,
  }
}
