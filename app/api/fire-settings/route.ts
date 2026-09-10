import type { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isFireType } from '@/lib/services/fire-planner'
import { loadFireSettings } from '@/lib/services/fire-planner-loader'
import { readFailed, writeFailed } from '@/lib/api-errors'

export const dynamic = 'force-dynamic'

/** GET /api/fire-settings — FIRE Planner の入力 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  try {
    return Response.json(await loadFireSettings(user.id, supabase))
  } catch (error) {
    return readFailed('api/fire-settings', error)
  }
}

/** 未指定 = 変更しない / null = 未入力へ戻す / 数値 = その値。不正なら 400 にする */
type Parsed<T> = { ok: true; value: T | undefined } | { ok: false; message: string }

function parseYen(value: unknown, label: string): Parsed<number | null> {
  if (value === undefined) return { ok: true, value: undefined }
  // 空文字と null は「未入力へ戻す」。0円とは別物として扱う
  if (value === null || value === '') return { ok: true, value: null }
  const parsed = Math.round(Number(value))
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false, message: `${label}は0円以上で入力してください` }
  }
  return { ok: true, value: parsed }
}

function parseRate(value: unknown, label: string, max: number): Parsed<number> {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) {
    return { ok: false, message: `${label}は0〜${max * 100}%の範囲で入力してください` }
  }
  return { ok: true, value: parsed }
}

/**
 * PUT /api/fire-settings
 *
 * 入力条件だけを保存する。必要資産・不足額は derived data なので保存しない
 * （保存すると、生活費を直したのに古い必要資産が残る）。
 *
 * 範囲外の値は黙って捨てず 400 を返す。無視すると「保存しました」と出たのに
 * 値が変わっていない状態になる。
 */
export async function PUT(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

  const livingCost = parseYen(body.monthly_living_cost, '月の生活費')
  const sideIncome = parseYen(body.post_fire_monthly_income, '副業・事業収入')
  const targetAssetIncome = parseYen(body.target_asset_income_monthly, '資産収入の目標')
  const returnRate = parseRate(body.assumed_return_rate, '想定利回り', 0.2)
  const taxRate = parseRate(body.tax_rate, '税率の仮定', 0.9)

  for (const parsed of [livingCost, sideIncome, targetAssetIncome, returnRate, taxRate]) {
    if (parsed.ok) continue
    // 自分で書いた入力エラー文だけを返す。DBのメッセージは readFailed / writeFailed 経由
    const { message } = parsed
    return Response.json({ error: message }, { status: 400 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (isFireType(body.fire_type)) patch.fire_type = body.fire_type
  if (livingCost.ok && livingCost.value !== undefined) {
    patch.monthly_living_cost = livingCost.value
  }
  if (sideIncome.ok && sideIncome.value !== undefined) {
    // 副業収入は「未入力」を許さない（0円が正しい既定値）
    patch.post_fire_monthly_income = sideIncome.value ?? 0
  }
  if (targetAssetIncome.ok && targetAssetIncome.value !== undefined) {
    patch.target_asset_income_monthly = targetAssetIncome.value
  }
  if (returnRate.ok && returnRate.value !== undefined) {
    patch.assumed_return_rate = returnRate.value
  }
  if (taxRate.ok && taxRate.value !== undefined) patch.tax_rate = taxRate.value

  // user_id は必ずセッションから。spread より後に置いて上書きされないようにする
  const { error } = await supabase
    .from('fire_settings')
    .upsert({ ...patch, user_id: user.id }, { onConflict: 'user_id' })

  if (error) return writeFailed('api/fire-settings', error)

  try {
    return Response.json(await loadFireSettings(user.id, supabase))
  } catch (error) {
    return readFailed('api/fire-settings', error)
  }
}
