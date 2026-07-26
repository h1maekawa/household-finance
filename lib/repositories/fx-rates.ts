// lib/repositories/fx-rates.ts
//
// 為替レートのキャッシュ。外貨建て固定費(ジブラルタ生命 105 USD)の円換算に使う。
//
// アクセス方針(docs/v3-architecture-review.md §9):
// - fx_rates は user_id を持たない「全ユーザー共通のマスタ」。RLS は read_all の select のみ。
// - 読みは通常のセッションクライアント。
// - 書き(レート更新)はユーザー文脈の無い管理操作なので service_role に限定する。
//   認証ユーザーに書きを許すと、1ユーザーが全ユーザーの為替レートを書き換えられてしまう。
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase'
import { getUsdToJpy } from '@/lib/stock'
import type { FxRates } from '@/lib/services/fixed-costs'

/** これより古いレートは取り直す */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000 // 6時間

/** 取得も過去値も無いときの最終フォールバック(lib/stock.ts と同じ値) */
const USD_JPY_FALLBACK = 150

export type FxRate = {
  pair: string
  rate: number
  updatedAt: string | null
  /** true = 外部から取り直せず、古い値かフォールバックを返している */
  stale: boolean
}

export async function getRate(pair: string): Promise<FxRate | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('fx_rates')
    .select('pair, rate, updated_at')
    .eq('pair', pair)
    .maybeSingle()

  // fx_rates が未作成でも固定費機能ごと落とさない
  if (error || !data) return null

  const updatedAt = data.updated_at as string | null
  const age = updatedAt ? Date.now() - Date.parse(updatedAt) : Number.POSITIVE_INFINITY

  return {
    pair: data.pair,
    rate: Number(data.rate),
    updatedAt,
    stale: !Number.isFinite(age) || age > STALE_AFTER_MS,
  }
}

async function upsertRate(pair: string, rate: number): Promise<void> {
  if (!isSupabaseConfigured) return
  const { error } = await supabaseAdmin
    .from('fx_rates')
    .upsert({ pair, rate, updated_at: new Date().toISOString() }, { onConflict: 'pair' })

  // キャッシュの書き込み失敗で呼び出し元を落とさない(次回また取りに行くだけ)
  if (error) console.warn('[fx-rates] failed to cache rate', pair, error.message)
}

/**
 * USD/JPY を返す。キャッシュが新しければ DB、古ければ Yahoo から取り直して保存する。
 *
 * 外部取得に失敗した場合は「古い DB 値」を返す。定数フォールバックは
 * DB にも何も無いときの最終手段。金額を 0 にしたり例外を投げたりはしない
 * ——固定費の円換算が消えるとキャッシュフローが実態より楽観的に見えるため。
 */
export async function getUsdToJpyCached(): Promise<FxRate> {
  const cached = await getRate('USDJPY')

  if (cached && !cached.stale && cached.rate > 0) return cached

  try {
    const fresh = await getUsdToJpy()
    if (Number.isFinite(fresh) && fresh > 0) {
      await upsertRate('USDJPY', fresh)
      return { pair: 'USDJPY', rate: fresh, updatedAt: new Date().toISOString(), stale: false }
    }
  } catch {
    // 下の古い値フォールバックへ
  }

  if (cached && cached.rate > 0) return { ...cached, stale: true }
  return { pair: 'USDJPY', rate: USD_JPY_FALLBACK, updatedAt: null, stale: true }
}

/** lib/services/fixed-costs.ts の resolveAmountYen に渡すレート表を組み立てる */
export async function loadFxRates(): Promise<FxRates> {
  const usd = await getUsdToJpyCached()
  return { USDJPY: usd.rate }
}
