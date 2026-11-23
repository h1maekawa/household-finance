// lib/services/liquid-cash-loader.ts
//
// 流動現金の収集(I/O)。計算は liquid-cash.ts の純関数に閉じ込める。
//
// セッション経路とサーバー間連携の両方から使えるよう、クライアントを
// 受け取れるようにする（budget-loader.ts と同じ形）。
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  countLiquidAccounts,
  resolveLiquidCash,
  type AccountBalanceRow,
  type AccountRow,
  type LegacyBalanceRow,
  type LiquidCash,
} from './liquid-cash'

export async function loadLiquidCash(
  userId: string,
  client?: SupabaseClient
): Promise<LiquidCash> {
  const supabase = client ?? (await createSupabaseServerClient())

  const [accountsRes, balancesRes] = await Promise.all([
    supabase.from('accounts').select('id, type').eq('user_id', userId),
    supabase.from('account_balances').select('account_id, balance, recorded_at').eq('user_id', userId),
  ])

  // 取得失敗を「口座なし」と混同しない。金融値をDBエラーから作らない
  if (accountsRes.error) throw new Error(`accounts の取得に失敗しました: ${accountsRes.error.message}`)
  if (balancesRes.error) {
    throw new Error(`account_balances の取得に失敗しました: ${balancesRes.error.message}`)
  }

  const accounts = (accountsRes.data ?? []) as AccountRow[]
  const balances = (balancesRes.data ?? []) as AccountBalanceRow[]

  // 旧テーブルは「流動口座が0件」のときだけ読む（判定は resolveLiquidCash）
  let legacy: LegacyBalanceRow | null = null
  if (countLiquidAccounts(accounts) === 0) {
    const legacyRes = await supabase
      .from('account_balance')
      .select('balance, recorded_at')
      .eq('user_id', userId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (legacyRes.error) {
      throw new Error(`account_balance の取得に失敗しました: ${legacyRes.error.message}`)
    }
    legacy = legacyRes.data ?? null
  }

  return resolveLiquidCash(accounts, balances, legacy)
}
